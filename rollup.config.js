// rollup.config.js
import typescript from "@rollup/plugin-typescript";
import {terser} from "rollup-plugin-terser";
import {namespaceName, scriptName} from "./rollup.globals";
import license from 'rollup-plugin-license';

export default {
    input: 'src/index.ts',
    output: [
        {
            file: `dist/js/${scriptName}.js`,
            name: namespaceName,
            format: 'iife'
        },
        {
            file: `dist/js/${scriptName}.min.js`,
            name: namespaceName,
            format: 'iife',
            plugins: [
                terser({
                    format: {
                        comments: false
                    },
                    compress: true,
                    mangle: true
                })
            ]
        }
    ],
    plugins: [
        typescript({
            target: "es2017",
            declaration: true,
            outDir: "dist/js",
            rootDir: "src",
            lib: [
                "es2020",
                "dom"
            ]
        }),
        license({
            banner: `<%= pkg.name %> v<%= pkg.version %>
Generated: <%= moment().format('YYYY-MM-DD HH:mm:ss') %>
Author: <%= pkg.author %>
LICENSE: <%= pkg.license %>`,
        })
    ]
};
