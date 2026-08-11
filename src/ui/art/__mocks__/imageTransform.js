const path = require('path');

/**
 * Resolves an image `require` to its filename under Jest.
 *
 * Metro turns `require('./x.png')` into an asset handle; Jest has no such
 * loader and chokes on the binary. A single shared stub would work, but it
 * would make all 81 generated sprite requires indistinguishable — and "nine
 * colours are nine different files" is a property worth testing, because a
 * packed texture silently produced nine identical atlases once already.
 */
module.exports = {
  process(_src, filename) {
    return { code: `module.exports = ${JSON.stringify(path.basename(filename))};` };
  },
  getCacheKey(_src, filename) {
    return filename;
  },
};
