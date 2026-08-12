import { createDelaunay32Worker } from "delaunay32";
import { startDemo } from "./demo.js";

const worker = await createDelaunay32Worker();
startDemo(worker);
