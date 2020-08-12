const GitRevisionPlugin = require('git-revision-webpack-plugin');
const gitRevision = new GitRevisionPlugin();
const HtmlWebpackPlugin = require('html-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: {
    main: './src/main.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]-[contentHash].js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      // ts-loader defined in dev and prod separately
      {
        test: /\.(png|woff2)$/,
        loader: 'file-loader',
        options: {
          name: '[name]-[sha1:hash:hex:20].[ext]',
        },
      },
      {
        test: /\.glsl$/,
        loader: 'raw-loader',
      },
      {
        test: /\.d\.ts$/,
        loader: 'declaration-loader'
      },
      { test: /\.(woff|woff2|eot|ttf|otf|svg)$/, use: ['url-loader?limit=100000'] },
      // {
      //   test: /\.css$/,
      //   use: [
      //     { loader: 'raw-loader' },
      //     { loader: 'css-loader' },
      //   ]
      // },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.s[ac]ss$/i,
        use: [
          // Creates `style` nodes from JS strings
          'style-loader',
          // Translates CSS into CommonJS
          'css-loader',
          // Compiles Sass to CSS
          'sass-loader',
        ]
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      '__COMMIT_HASH': JSON.stringify(gitRevision.commithash()),
    }),
    new webpack.IgnorePlugin({
      // Workaround for broken libraries
      resourceRegExp: /^(fs|path)$/,
    }),
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: [
        '**/*',
        '!data',
        '!data/**/*',
        '!.htaccess',
      ],
    }),
    new HtmlWebpackPlugin({
      chunks: ['main'],
      filename: 'index.html',
      template: './src/index.html',
    }),
    new HtmlWebpackPlugin({
      chunks: ['main'],
      filename: 'embed.html',
      template: './src/index.html',
    }),
    new CopyPlugin([
      // All .wasm files are currently expected to be at the root
      {from: 'src/**/*.wasm', flatten: true},
      'node_modules/librw/lib/librw.wasm',
    ]),
  ],
};
