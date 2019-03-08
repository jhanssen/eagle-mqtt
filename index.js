const http = require("http");
const path = require("path");
const options = require("@jhanssen/options")("eagle-mqtt");
const mqtt = require('mqtt');
const xml2js = require("xml2js");
const parser = new xml2js.Parser();

const httpPort = options.int("http-port", 22043);
const mqttHost = options("mqtt-host");
const mqttPort = options.int("mqtt-port", 1883);
const mqttUser = options("mqtt-user");
const mqttPassword = options("mqtt-password");
const mqttTopic = options("mqtt-topic", "/rainforest");

if (!mqttHost) {
    console.error("Need a mqtt host");
    process.exit(1);
}

let mqttUrl = "mqtt://";
if (mqttUser || mqttPassword) {
    mqttUrl += `${mqttUser || ""}:${mqttPassword || ""}@`;
}
mqttUrl += mqttHost + ":" + mqttPort;

console.log("connecting to", mqttUrl);
const mqttClient = mqtt.connect(mqttUrl);
mqttClient.on("error", err => {
    console.error("mqtt error", err);
    process.exit(1);
});
mqttClient.on("connect", () => {
    console.log("connected to mqtt");
});

class InstantaneousDemand
{
    constructor(macId, data)
    {
        this.macId = macId;
        this.timeStamp = parseInt(data.TimeStamp[0]);

        const divisor = parseInt(data.Divisor[0]);
        const multiplier = parseInt(data.Multiplier[0]);

        this.demand = parseInt(data.Demand[0]) * multiplier / divisor;
    }

    subTopic() {
        return "demand";
    }

    toJSON() {
        return JSON.stringify({ macId: this.macId, timeStamp: this.timeStamp, demand: this.demand });
    }
}

class CurrentSummationDelivered
{
    constructor(macId, data)
    {
        this.macId = macId;
        this.timeStamp = parseInt(data.TimeStamp[0]);

        const divisor = parseInt(data.Divisor[0]);
        const multiplier = parseInt(data.Multiplier[0]);

        this.delivered = parseInt(data.SummationDelivered[0]) * multiplier / divisor;
        this.received = parseInt(data.SummationReceived[0]) * multiplier / divisor;
    }

    subTopic() {
        return "summationDelivered";
    }

    toJSON() {
        return JSON.stringify({ macId: this.macId, timeStamp: this.timeStamp, delivered: this.delivered, received: this.received });
    }
}

console.log("listening on", httpPort);
http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString(); // convert Buffer to string
    });
    req.on('end', () => {
        // console.log(body);
        const obj = parser.parseString(body, (err, result) => {
            if (result && !err) {
                if ("rainforest" in result) {
                    const rainforest = result.rainforest;
                    if ("$" in rainforest) {
                        if ("InstantaneousDemand" in rainforest) {
                            for (let i = 0; i < rainforest.InstantaneousDemand.length; ++i) {
                                const obj = new InstantaneousDemand(rainforest.$.macId, rainforest.InstantaneousDemand[i]);
                                console.log("publishing to", path.join("/", mqttTopic, obj.subTopic()));
                                mqttClient.publish(path.join("/", mqttTopic, obj.subTopic()), obj.toJSON());
                            }
                        } else if ("CurrentSummationDelivered" in rainforest) {
                            for (let i = 0; i < rainforest.CurrentSummationDelivered.length; ++i) {
                                const obj = new CurrentSummationDelivered(rainforest.$.macId, rainforest.CurrentSummationDelivered[i]);
                                console.log("publishing to", path.join("/", mqttTopic, obj.subTopic()));
                                mqttClient.publish(path.join("/", mqttTopic, obj.subTopic()), obj.toJSON());
                            }
                        } else {
                            console.log("got xml", JSON.stringify(result, null, 4));
                        }
                    }
                }
            }
            res.end();
        });
    });
}).listen(httpPort);
