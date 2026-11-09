import { mkdir, rm, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'favicon.svg', 'MARS.SAV', 'MARS.DAT']) await copyFile(new URL(file, root), new URL(file, dist));
await cp(new URL('src/', root), new URL('src/', dist), { recursive: true });
await cp(new URL('assets/fonts/', root), new URL('assets/fonts/', dist), { recursive: true });
const read = file => readFile(new URL(file, root), 'utf8');
const modules = await Promise.all(['src/pdp11.js', 'src/terminal.js', 'src/machine.js', 'src/font-rom.js', 'src/font.js', 'src/crt.js', 'app.js'].map(read));
const bundle = modules.map(source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
const archive = {
  sav: (await readFile(new URL('MARS.SAV', root))).toString('base64'),
  dat: (await readFile(new URL('MARS.DAT', root))).toString('base64'),
};
let standalone = (await read('index.html'))
  .replace('<link rel="stylesheet" href="styles.css">', '<style>' + await read('styles.css') + '</style>')
  .replace('<script type="module" src="app.js"></script>', '<script type="application/json" id="mars-archive">' + JSON.stringify(archive) + '</script><script type="module">' + bundle.replaceAll('</script', '<\\/script') + '</script>')
  .replace('href="favicon.svg"', 'href="data:image/svg+xml;base64,' + Buffer.from(await read('favicon.svg')).toString('base64') + '"')
  .replace('href="./"', 'href="#"');
await writeFile(new URL('МАРС.html', root), standalone);
await writeFile(new URL('МАРС.html', dist), standalone);
console.log('Static build ready in dist/');
console.log('Offline single-file game: МАРС.html');
