import "./style.css";

import { initApp } from "./app";

const root = document.getElementById("app");
if (!root) {
  throw new Error("#app root element not found");
}

initApp(root);
