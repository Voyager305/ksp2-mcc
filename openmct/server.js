// Serves the real NASA Open MCT dist + our KSP2 telemetry plugin.
const express = require("express");
const path = require("path");

const app = express();

// Open MCT distributable (node_modules/openmct/dist)
const distDir = path.dirname(require.resolve("openmct"));
app.use("/openmct-dist", express.static(distDir));

// our page + plugin
app.use("/", express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Open MCT frontend on :${PORT}`));
