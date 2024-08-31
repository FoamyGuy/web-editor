import Chart from "chart.js/auto";

let textLineBuffer = "";
let textLine;

let defaultColors = ['#8888ff', '#ff8888', '#88ff88'];

/**
 * @name LineBreakTransformer
 * Helper to parse the incoming string messages into lines.
 */
class LineBreakTransformer {
    constructor() {
        // A container for holding stream data until a new line.
        this.container = '';
    }

    transform(chunk, linesList) {
        this.container += chunk;
        const lines = this.container.split('\n');
        this.container = lines.pop();
        lines.forEach(line => linesList.push(line));
    }

}

let lineTransformer = new LineBreakTransformer()

export function plotValues(chartObj, serialMessage, bufferSize) {
    /*
    Given a string serialMessage, parse it into the plottable value(s) that
    it contains if any, and plot those values onto the given chartObj. If
    the serialMessage doesn't represent a complete textLine it will be stored
    into a buffer and combined with subsequent serialMessages until a full
    textLine is formed.
     */
    let currentLines = []
    lineTransformer.transform(serialMessage, currentLines)

    //console.log("currentLines: " + currentLines);

    for (textLine of currentLines) {

        textLine = textLine.replace("\r", "").replace("\n", "")
        if (textLine.length === 0) {
            continue;
        }
        //console.log("plotter is enabled, data is: '" + textLine + "'");
        //console.log("bytes: " + stringToBytes(textLine));

        let valuesToPlot;

        //console.log("starts and ends: " + textLine.startsWith("(") + ", " + textLine.endsWith(")"));
        // handle possible tuple in textLine
        if (textLine.startsWith("(") && textLine.endsWith(")")) {
            textLine = "[" + textLine.substring(1, textLine.length - 1) + "]";
            console.log("after tuple conversion: " + textLine);
        }

        // handle possible list in textLine
        if (textLine.startsWith("[") && textLine.endsWith("]")) {
            valuesToPlot = JSON.parse(textLine);
            for (let i = 0; i < valuesToPlot.length; i++) {
                valuesToPlot[i] = parseFloat(valuesToPlot[i])
            }

        } else { // handle possible CSV in textLine
            valuesToPlot = textLine.split(",")
            for (let i = 0; i < valuesToPlot.length; i++) {
                valuesToPlot[i] = parseFloat(valuesToPlot[i])
            }
        }

        if (valuesToPlot === undefined || valuesToPlot.length === 0) {
            continue;
        }

        try {
            while (chartObj.data.labels.length > bufferSize) {
                chartObj.data.labels.shift();
                for (let i = 0; i < chartObj.data.datasets.length; i++) {
                    while (chartObj.data.datasets[i].data.length > bufferSize) {
                        chartObj.data.datasets[i].data.shift();
                    }
                }
            }
            chartObj.data.labels.push("");
            /*chartObj.data.labels.push(new Date().toLocaleString('en-US', {
                hour: 'numeric', // numeric, 2-digit
                minute: 'numeric', // numeric, 2-digit
                second: 'numeric', // numeric, 2-digit
                millisecond: 'numeric', // numeric, 2-digit
            }));*/

            for (let i = 0; i < valuesToPlot.length; i++) {
                if (isNaN(valuesToPlot[i])) {
                    continue;
                }
                if (i > chartObj.data.datasets.length - 1) {
                    let curColor = '#000000';
                    if (i < defaultColors.length) {
                        curColor = defaultColors[i];
                    }
                    chartObj.data.datasets.push({
                        label: i.toString(),
                        data: [],
                        borderColor: curColor,
                        backgroundColor: curColor
                    });
                }
                chartObj.data.datasets[i].data.push(valuesToPlot[i]);
            }

            updatePlotterScales(chartObj);
            chartObj.update();
        } catch (e) {

            console.log("JSON parse error");
            //console.log(e)
            console.log(e.stack);
            // This line isn't a valid data value
        }
    }
}

function stringToBytes(val) {
    const result = [];
    for (let i = 0; i < val.length; i++) {
        result.push(val.charCodeAt(i));
    }
    return result;
}

function updatePlotterScales(chartObj) {
    let allData = []
    for (let i = 0; i < chartObj.data.datasets.length; i++) {
        allData = allData.concat(chartObj.data.datasets[i].data)
    }
    chartObj.options.scales.y.min = Math.min(...allData) - 10
    chartObj.options.scales.y.max = Math.max(...allData) + 10
}

export async function setupPlotterChart(workflow) {

    let initialData = []
    Chart.defaults.backgroundColor = '#444444';
    Chart.defaults.borderColor = '#000000';
    Chart.defaults.color = '#000000';
    Chart.defaults.aspectRatio = 3/2;
    workflow.plotterChart = new Chart(
        document.getElementById('plotter-canvas'),
        {
            type: 'line',

            // responsive: true,
            // maintainAspectRatio: false,
            options: {
                animation: false,
                scales: {
                    y: {
                        min: -1,
                        max: 1,
                        grid:{
                            color: "#666"
                        },
                        border: {
                            color: "#444"
                        }

                    },
                    x:{
                        grid: {
                            display: true,
                            color: "#666"
                        },
                        border: {
                            color: "#444"
                        }
                    }
                }
            },
            data: {
                labels: initialData.map(row => row.timestamp),
                datasets: [
                    {
                        label: '0',
                        data: initialData.map(row => row.value)
                    }
                ]
            }
        }
    );
    workflow.plotterGridLines.addEventListener('change', (event) => {
        //console.log("data: " + event.target);
        //console.dir(event.target);
        //console.log("value: " + event.target.value);
        //console.log(workflow.plotterGridLines.value);
        let gridChoice = event.target.value;
        if (gridChoice === "x"){
            workflow.plotterChart.options.scales.x.grid.display = true;
            workflow.plotterChart.options.scales.y.grid.display = false;
        }else if (gridChoice === "y"){
            workflow.plotterChart.options.scales.y.grid.display = true;
            workflow.plotterChart.options.scales.x.grid.display = false;
        }else if (gridChoice === "both"){
            workflow.plotterChart.options.scales.y.grid.display = true;
            workflow.plotterChart.options.scales.x.grid.display = true;
        }else if (gridChoice === "none"){
            workflow.plotterChart.options.scales.y.grid.display = false;
            workflow.plotterChart.options.scales.x.grid.display = false;
        }
        workflow.plotterChart.update();
    });

}