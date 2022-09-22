import {sleep, timeout} from '../common/utilities.js';
import {FileHelper} from '../common/file.js';
import {UnsavedDialog} from '../common/dialogs.js';
import {FileDialog, FILE_DIALOG_OPEN, FILE_DIALOG_SAVE} from '../common/file_dialog.js';

/*
 * This class will encapsulate all of the common workflow-related functions
 */

const CONNTYPE = {
    None: 1,
    Ble: 2,
    Usb: 3,
    Web: 4
};

const CHAR_CTRL_C = '\x03';
const CHAR_CTRL_D = '\x04';
const CHAR_CRLF = '\x0a\x0d';
const CHAR_TITLE_START = "\x1b]0;";
const CHAR_TITLE_END = "\x1b\\";

class Workflow {
    constructor() {
        this.terminal = null;
        this.terminalTitle = null;
        this.debugLog = null;
        this.loader = null;
        this.type = CONNTYPE.None;
        this.partialWrites = false;
        this.disconnectCallback = null;
        this.loadEditor = null;
        this.timeout = timeout;
        this.sleep = sleep;
        this.connectDialog = null;
        this._connected = false;
        this.currentFilename = null;
        this.fileHelper = null;
        this._unsavedDialog = new UnsavedDialog("unsaved");
        this._fileDialog = new FileDialog("files", this.showBusy.bind(this));
    }

    async init(params) {
        this.terminal = params.terminal;
        this.debugLog = params.debugLogFunc;
        this.disconnectCallback = params.disconnectFunc;
        this.loadEditor = params.loadEditorFunc;
        this._isDirty = params.isDirtyFunc;
        this._setFilename = params.setFilenameFunc;
        this._writeText = params.writeTextFunc;
        this._loadEditorContents = params.loadEditorContentsFunc;
        this.loader = document.getElementById("loader");
        if ("terminalTitle" in params) {
            this.terminalTitle = params.terminalTitle;
        }
        this.currentFilename = params.currentFilename;
    }

    async initFileClient(fileClient) {
        this.fileHelper = new FileHelper(fileClient);
    }

    async getDeviceFileContents() {
        let filename = this.currentFilename;
        if (!filename) {
            return "";
        }
        return await this.showBusy(this.fileHelper.readFile(this.currentFilename));
    }

    async disconnectButtonHandler(e) {

    }

    async connect() {
        return await this.available();
    }

    tokenize(string) {
        const tokenRegex = new RegExp("(" + regexEscape(CHAR_TITLE_START) + "|" + regexEscape(CHAR_TITLE_END) + ")", "gi");
        return string.split(tokenRegex);
    }

    makeDocState(document, docChangePos) {
        return {
            path: this.currentFilename,
            contents: document,
            pos: docChangePos,
        };
    }

    async onDisconnected(e, reconnect = true) {
        this.debugLog("disconnected");
        this.updateConnected(false);
        // Update Common UI Elements
        if (this.disconnectCallback) {
            this.disconnectCallback();
        }
        if (reconnect) {
            await this.connect();
        }
    }

    async onConnected(e) {
        this.debugLog("connected");
        console.log("Connected!");
        this.updateConnected(true);
        if (this.connectDialog) {
            this.connectDialog.close();
        }
    }

    async onSerialReceive(e) {
        if (e.data == CHAR_TITLE_START) {
            this.titleMode = true;
            this.setTerminalTitle("");
        } else if (e.data == CHAR_TITLE_END) {
            this.titleMode = false;
        } else if (this.titleMode) {
            this.setTerminalTitle(e.data, true);
        } else {
            this.writeToTerminal(e.data);
        }
    }

    connectionStatus() {
        return this._connected;
    }

    async deinit() {

    }

    updateConnected(isConnected) {
        this._connected = isConnected;
    }

    async showBusy(functionPromise, darkBackground = true) {
        if (this.loader) {
            if (darkBackground) {
                this.loader.classList.add("overlay");
            } else {
                this.loader.classList.remove("overlay");
            }
            this.loader.classList.add("busy");
        }
        let result = await functionPromise;
        if (this.loader) {
            this.loader.classList.remove("busy");
        }
        return result;
    }

    async parseParams(urlParams) {
        // Workflow specific params check
        return false;
    }

    writeToTerminal(data) {
        this.terminal.write(data);
    }

    setTerminalTitle(title, append = false) {
        if (this.terminalTitle == null) {
            return;
        }

        if (append) {
            title = this.terminalTitle.textContent + title;
        }

        this.terminalTitle.textContent = title;
    }

    async showConnect(documentState) {
        return await this.connectDialog.open();
    }

    async runCode() {
        let path = this.currentFilename;

        if (!path) {
            console.log("File has not been saved");
            return;
        }

        if (path == "/code.py") {
            await this.serialTransmit(CHAR_CTRL_D);
        }

        let extension = path.split('.').pop();
        if (extension === null) {
            console.log("Extension not found");
            return false;
        }
        if (String(extension).toLowerCase() != "py") {
            console.log("Extension not py, twas " + String(extension).toLowerCase());
            return false;
        }
        path = path.substr(1, path.length - 4);
        path = path.replace(/\//g, ".");

        await changeMode(MODE_SERIAL);
        await this.serialTransmit(CHAR_CTRL_C + "import " + path + CHAR_CRLF);
    }

    async checkSaved() {
        if (this._isDirty()) {
            let result = await this._unsavedDialog.open("Current changes will be lost. Do you want to save?");
            if (result !== null) {
                if (!result || await this.saveFile()) {
                    return true;
                }
            }
            return false;
        }
        return true;
    }

    async saveFile(path) {
        const previousFile = this.currentFilename;
        if (path !== undefined) {
            // All good, continue
        } else if (this.currentFilename !== null) {
            path = this.currentFilename;
        } else {
            path = await this.saveAs();
        }
        if (path !== null) {
            this.currentFilename = path;
            // If this is a different file, we write everything
            await this._writeText(path !== previousFile ? 0 : null);
            return true;
        }
        this.currentFilename = previousFile;
        return false;
    }

    async saveAs() {
        let path = await this.openFileDialog(FILE_DIALOG_SAVE);
        if (path !== null) {
            // check if filename exists
            if (path != this.currentFilename && await this.showBusy(this.fileHelper.fileExists(path))) {
                if (window.confirm("Overwrite existing file '" + path + "'?")) {
                    await this.saveFile(path);
                } else {
                    return null;
                }
            } else {
                await this.saveFile(path);
            }
        }
        return path;
    }

    async openFile() {
        if (await this.checkSaved()) {
            let path = await this.openFileDialog(FILE_DIALOG_OPEN);
            if (path !== null) {
                let contents = await this.showBusy(this.fileHelper.readFile(path));
                this._loadEditorContents(contents);
                this._setFilename(path);
                console.log("Current File Changed to: " + this.currentFilename);
                return true;
            }
        }
        return false;
    }

    // Open a file dialog and return the path or null if canceled
    async openFileDialog(type) {
        return await this._fileDialog.open(this.fileHelper, type);
    }

    async writeFile(contents, offset = 0) {
        return await this.showBusy(
            this.fileHelper.writeFile(this.currentFilename, offset, contents)
        );
    }

    async readOnly() {
        return await this.fileHelper.readOnly();
    }

    async parseParams() {
        return false;
    }

    async available() {
        return Error("This work flow is not available.");
    }
}

export {Workflow, CHAR_CTRL_C, CHAR_CTRL_D, CHAR_CRLF, CHAR_TITLE_START, CHAR_TITLE_END, CONNTYPE};