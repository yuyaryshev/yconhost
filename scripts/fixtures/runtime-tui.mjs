import fs from "node:fs";

const trace = process.argv[2];
let tick = 0;
let input = "";
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdout.write("\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[2J");
function render() {
  process.stdout.write(`\x1b[1;1H\x1b[32mRuntime test PID ${process.pid} tick ${++tick}\x1b[0m\x1b[K\x1b[3;1HInput: ${input}\x1b[K`);
  if (trace) fs.appendFileSync(trace, `${tick}\n`);
}
const timer = setInterval(render, 100);
process.stdin.on("data", data => {
  const text = data.toString();
  if (text.includes("\x03")) {
    clearInterval(timer); process.stdout.write("\x1b[?1000l\x1b[?2004l\x1b[?1049l"); process.exit(0);
  }
  input += text.replace(/[\r\n]/g, ""); render();
});
render();
