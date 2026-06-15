// Generated using webpack-cli https://github.com/webpack/webpack-cli

import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Configuration } from "webpack";
import "webpack-dev-server";
import HtmlWebpackPlugin from "html-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import CopyPlugin from "copy-webpack-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === "production";
const stylesHandler = isProduction ? MiniCssExtractPlugin.loader : "style-loader";

/** @type {import("webpack").Configuration} */
const config: Configuration = {
    entry: "./src/index.ts",
    output: {
        path: path.resolve(__dirname, "dist"),
    },
    devServer: {
        open: true,
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: "index.html",
        }),
        // Add your plugins here
        // Learn more about plugins from https://webpack.js.org/configuration/plugins/
        new CopyPlugin({
            patterns: [{ from: "data", to: "data" }],
        }),
    ],
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/i,
                loader: "ts-loader",
                exclude: ["/node_modules/"],
            },
            {
                test: /\.css$/i,
                use: [stylesHandler, "css-loader", "postcss-loader"],
            },
            {
                test: /\.(eot|svg|ttf|woff|woff2|png|jpg|gif)$/i,
                type: "asset",
            },

            {
                test: /\.html$/i,
                use: ["html-loader"],
            },

            // Add your rules for custom modules here
            // Learn more about loaders from https://webpack.js.org/loaders/
        ],
    },
    resolve: {
        extensions: [".tsx", ".ts", ".jsx", ".js", "..."],
    },
};

export default () => {
    if (isProduction) {
        config.mode = "production";
        config.plugins?.push(new MiniCssExtractPlugin());
    } else {
        config.mode = "development";
    }
    return config;
};
