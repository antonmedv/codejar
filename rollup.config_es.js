import typescript from '@rollup/plugin-typescript';
import generatePackageJson from 'rollup-plugin-generate-package-json'
import {namespaceName} from "./rollup.globals";

// rollup.config.js
export default {
    input: 'src/index.ts',
    output: {
        dir: 'dist/es',
        name: namespaceName,
        format: 'es'
    },
    plugins: [
        typescript({
            target: "es2017",
            declaration: true,
            outDir: "dist/es",
            rootDir: "src",
            "lib": [
                "es2020",
                "dom"
            ]
        }),
        generatePackageJson({
            outputFolder: "dist",
            baseContents: (pkg) => {
                pkg.main = "es/index.js";
                pkg.scripts = undefined;
                return pkg;
            }
        })
    ]
};
