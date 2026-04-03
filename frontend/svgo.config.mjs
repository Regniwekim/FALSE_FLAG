export default {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          removeViewBox: false,
          cleanupIds: false
        }
      }
    },
    {
      name: "convertPathData",
      params: {
        floatPrecision: 0,
        transformPrecision: 0
      }
    },
    {
      name: "cleanupNumericValues",
      params: {
        floatPrecision: 0
      }
    },
    {
      name: "sortAttrs"
    }
  ]
};