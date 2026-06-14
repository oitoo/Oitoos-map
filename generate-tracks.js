const fs = require("fs");
const path = require("path");

const baseDir = path.join(__dirname, "tracks");

const categories = fs.readdirSync(baseDir);

let tracks = [];

categories.forEach(category => {
  const categoryPath = path.join(baseDir, category);

  const files = fs.readdirSync(categoryPath);

  files.forEach(file => {
    if (file.endsWith(".gpx")) {
      tracks.push(`tracks/${category}/${file}`);
    }
  });
});

fs.writeFileSync(
  "tracks.js",
  `const tracks = ${JSON.stringify(tracks, null, 2)};`
);

console.log("tracks.js generated successfully!");

//Al terminal
//node generate-tracks.js