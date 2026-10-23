// Child-process-only replacements: never load credentials, browsers or listeners.
// Mock the relocated startup modules themselves so none of their imports run.
// Unexpected application imports fail closed instead of reaching real services.
const build = new URL("../../../build/", import.meta.url).href;
const mark = `const mark = (name) => process.stderr.write("boundary:" + name + "\\n");`;
const sources = {
  "./serve.js": `${mark} mark(process.argv[2] === "http" ? "listener" : "direct-stdio");`,
  "./shared-stdio.js": `${mark} export async function runSharedStdio() { mark("shared-stdio"); }`,
};
for (const name of ["setup", "auth-cli", "doctor"]) {
  sources[`./${name}.js`] = `${mark} mark(${JSON.stringify(name)}); process.stderr.write("args:" + JSON.stringify(process.argv.slice(3)) + "\\n");`;
}

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL === `${build}index.js` && !specifier.startsWith("node:")) {
    if (!(specifier in sources)) throw new Error(`Unmocked entry dependency: ${specifier}`);
    return { url: `entry-mock:${specifier}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("entry-mock:")) {
    return { format: "module", source: sources[url.slice("entry-mock:".length)], shortCircuit: true };
  }
  return nextLoad(url, context);
}
