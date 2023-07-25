import esbuild from 'esbuild'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

/**
 * @returns {import('esbuild').Plugin}
 */
function patchRecast() {
  return {
    // https://github.com/benjamn/recast/issues/611
    name: 'patch-recast',
    setup(build) {
      build.onLoad({ filter: /recast\/lib\/patcher\.js$/ }, async (args) => {
        let original = await fs.promises.readFile(args.path, 'utf8')

        return {
          contents: original
            .replace(
              'var nls = needsLeadingSpace(lines, oldNode.loc, newLines);',
              'var nls = oldNode.type !== "TemplateElement" && needsLeadingSpace(lines, oldNode.loc, newLines);',
            )
            .replace(
              'var nts = needsTrailingSpace(lines, oldNode.loc, newLines)',
              'var nts = oldNode.type !== "TemplateElement" && needsTrailingSpace(lines, oldNode.loc, newLines)',
            ),
        }
      })
    },
  }
}

/**
 * @returns {import('esbuild').Plugin}
 */
function patchDynamicRequires() {
  return     {
    name: 'patch-dynamic-requires',
    setup(build) {
      build.onEnd(async () => {
        let outfile = './dist/index.mjs'

        let content = await fs.promises.readFile(outfile)

        // Prepend `createRequire`
        content = `import {createRequire} from 'module';\n${content}`

        // Replace dynamic require error with createRequire
        content = content.replace(
          `throw Error('Dynamic require of "' + x + '" is not supported');`,
          `return createRequire(import.meta.url).apply(this, arguments);`,
        )

        fs.promises.writeFile(outfile, content)
      })
    },
  }
}

/**
 * @returns {import('esbuild').Plugin}
 */
function copyTypes() {
  return {
    name: 'copy-types',
    setup(build) {
      build.onEnd(() =>
        fs.promises.copyFile(
          path.resolve(__dirname, './src/index.d.ts'),
          path.resolve(__dirname, './dist/index.d.ts'),
        ),
      )
    },
  }
}


const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {Partial<import('esbuild').BuildOptions>} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node14.13.0',
  external: ['prettier'],
  minify: process.argv.includes('--minify'),
}

let contexts = await Promise.all([
  // Prettier v2
  esbuild.context({
    ...common,
    entryPoints: [path.resolve(__dirname, './src/index.cjs')],
    outfile: path.resolve(__dirname, './dist/index.js'),
    format: "cjs",
    define: {
      __IS_PRETTIER_3__: 'false',
    },
    plugins: [
      patchRecast(),
      copyTypes(),
    ],
  }),

  // Prettier v3
  esbuild.context({
    ...common,
    entryPoints: [path.resolve(__dirname, './src/index.mjs')],
    outfile: path.resolve(__dirname, './dist/index.mjs'),
    format: "esm",
    define: {
      __IS_PRETTIER_3__: 'true',
    },
    plugins: [
      patchRecast(),
      patchDynamicRequires(),
      copyTypes(),
    ],
  }),
])

await Promise.all(contexts.map(context => context.rebuild()))

if (process.argv.includes('--watch')) {
  await Promise.all(contexts.map(context => context.watch()))
}

await Promise.all(contexts.map(context => context.dispose()))