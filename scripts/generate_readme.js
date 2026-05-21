import fs from "fs/promises"
import path from "path"

const RELEASEDIR = "./releases",
	PREVIEWDIR = "./previews"

await fs.mkdir(PREVIEWDIR, { recursive: true })

const TAGS = {
	tile: "snapshot-2026-05-22",
	tile_1_0: "snapshot-2026-05-22",
	tile_1_1: "snapshot-2026-05-22",
	tile_1_2: "snapshot-2026-05-22",
	tile_1_2_1: "snapshot-2026-05-22"
}

const versions = (await fs.readdir(RELEASEDIR, { withFileTypes: true }))
	.filter(d => d.isDirectory())
	.map(d => d.name)
	.sort()

const sections = []

for (const ver of versions) {
	const verDir = path.join(RELEASEDIR, ver)

	const maps = (await fs.readdir(verDir, { withFileTypes: true }))
		.filter(d => d.isDirectory())
		.map(d => d.name)
		.sort()

	const previews = []

	for (const map of maps) {
		const src = path.join(verDir, map, "3", "map_lossy.webp"),
			dstName = `${ver}-${map}.webp`,
			dst = path.join(PREVIEWDIR, dstName)

		try {
			await fs.copyFile(src, dst)
			previews.push({ map, file: dstName })
			console.log("copied", src, "to", dst)
		} catch {
			console.log("missing", src)
		}
	}

	const tag = TAGS[ver]
	if (!tag) throw new Error("no tag found for version " + ver)

	sections.push(`### \`${ver}\`\n`)

	sections.push(
		`[\`tilesets-${ver}.zip\`](https://github.com/ziplines/endfield-map-data/releases/download/${tag}/tilesets-${ver}.zip)`,
		`[\`maps-${ver}.zip\`](https://github.com/ziplines/endfield-map-data/releases/download/${tag}/maps-${ver}.zip)\n`
	)

	sections.push("| Map | Preview |")
	sections.push("| --- | --- |")

	for (const preview of previews)
		sections.push(`| \`${preview.map}\` | <img src="./previews/${preview.file}" height=500> |`)

	sections.push("")
}

const readme = `# Endfield Map Data

Unofficial archive of map tiles and stitched map assets sourced from the official Arknights: Endfield interactive map.

## Downloads

${sections.join("\n")}
`

await fs.writeFile("./README.md", readme)

console.log("done")
