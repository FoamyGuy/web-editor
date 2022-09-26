class FileTransferClient {
    constructor(hostname, connectionStatusCB) {
        this.hostname = hostname;
        this.connectionStatus = connectionStatusCB;
        this._allowedMethods = null;
    }

    async readOnly() {
        await this._checkConnection();
        return !this._allowedMethods.includes('DELETE');
    }

    async _checkConnection() {
        if (!this.connectionStatus() && this._allowedMethods !== null) {
            throw new Error("Unable to perform file operation. Not Connected.");
        }

        if (this._allowedMethods === null) {
            const status = await this._fetch("/fs/", {method: "OPTIONS"});
            this._allowedMethods = status.headers.get("Access-Control-Allow-Methods").split(/,/).map(method => {return method.trim().toUpperCase();});
        }
    }

    async readFile(path, raw = false) {
        return await this._readFile(path, raw, '/fs');
    }

    async _readFile(path, raw, rootDir) {
        await this._checkConnection();
        const response = await this._fetch(`${rootDir}${path}`);

        if (response.ok) {
            return raw ? await response.blob() : await response.text();
        } else {
            return raw ? null : "";
        }
    }

    async _checkWritable() {
        if (await this.readOnly()) {
            throw new Error("File System is Read Only. Try disabling the USB Drive.");
        }
    }

    async writeFile(path, offset, contents, modificationTime, raw = false) {
        await this._checkConnection();
        await this._checkWritable();

        let options = {
            method: 'PUT',
            body: contents,
            headers: {
                "X-Timestamp": modificationTime
            }
        };

        if (raw) {
            options.headers['Content-Type'] = "application/octet-stream";
        }

        await this._fetch(`/fs${path}`, options);
    }

    // Makes the directory and any missing parents
    async makeDir(path, modificationTime = Date.now()) {
        await this._checkConnection();
        await this._checkWritable();

        if (!path.length || path.substr(-1) != "/") {
            path += "/";
        }

        let options = {
            method: 'PUT',
            headers: {
                "X-Timestamp": modificationTime
            }
        };

        const response = await this._fetch(`/fs${path}`, options);
        return response.ok;
    }

    async _fetch(location, options = {}) {
        let response;
        let fetchOptions = {
            credentials: 'include',
            ...options
        };

        if (fetchOptions.method && fetchOptions.method.toUpperCase() != 'OPTIONS') {
            if (!this._isMethodAllowed(fetchOptions.method)) {
                if (fetchOptions.method.toUpperCase() == "MOVE") {
                    // This should only happen if rename is used and the user doesn't have latest version
                    console.warn("Please upgrade to the latest version of CircuitPython. Allowing MOVE for now.");
                } else {
                    throw new ProtocolError(`${fetchOptions.method} is not allowed.`);
                }
            }
        }

        try {
            response = await fetch(new URL(location, `http://${this.hostname}`), fetchOptions);
        } catch (error) {
            throw new ProtocolError(`Host '${this.hostname}' not found.`);
        }

        if (!response.ok) {
            throw new ProtocolError(response.statusText);
        }

        return response;
    }

    async _isMethodAllowed(method) {
        if (this._allowedMethods) {
            return this._allowedMethods.includes(method.toUpperCase);
        }

        return false;
    }

    // Returns a list of tuples, one tuple for each file or directory in the given path
    async listDir(path) {
        await this._checkConnection();

        let paths = [];
        if (!path.length || path.substr(-1) != "/") {
            path += "/";
        }

        const response = await this._fetch(`/fs${path}`, {headers: {"Accept": "application/json"}});
        const results = await response.json();
        for (let result of results) {
            paths.push({
                path: result.name,
                isDir: result.directory,
                fileSize: result.file_size,
                fileDate: Number(result.modified_ns / 1000000),
            });
        }

        return paths;
    }

    // Deletes the file or directory at the given path. Directories must be empty.
    async delete(path) {
        await this._checkConnection();
        await this._checkWritable();

        const response = await this._fetch(`/fs${path}`, {method: "DELETE"});
        return response.ok;
    }

    // Moves the file or directory from oldPath to newPath.
    async move(oldPath, newPath) {
        await this._checkConnection();
        await this._checkWritable();

        let options = {
            method: 'MOVE',
            headers: {
                "X-Destination": `/fs${newPath}`
            }
        };

        const response = await this._fetch(`/fs${oldPath}`, options);
        return response.ok;
    }

    async versionInfo() {
        let response = await this._readFile('/version.json', true, '/cp');
        if (!response) {
            return null;
        }
        return await response.json();
    }

    async otherDevices() {
        let response = await this._readFile('/devices.json', true, '/cp');
        if (!response) {
            return null;
        }
        return await response.json();
    }

    static async getRedirectedHost(host) {
        let versionResponse;
        try {
            versionResponse = await fetch(`http://${host}/cp/version.json`, {mode: "cors"});
        } catch (error) {
            console.error(`Host '${host}' not found.`);
            throw new ProtocolError(`Host '${host}' not found.`);
        }
        return new URL("/", versionResponse.url).host;
    }
}

class ProtocolError extends Error {
    constructor(message) {
        super(message);
        this.name = "ProtocolError";
    }
}

export {FileTransferClient, ProtocolError};