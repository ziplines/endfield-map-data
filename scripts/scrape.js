import fs from "fs/promises"
import path from "path"
import sharp from "sharp"

const BASE = "https://assets.skport.com/game-map/endfield/"

const TILESETS = []

const tilesets_pre = [
	["tile/map01/", [[-1, 0], [-1, 0], [-1, 0], [-2, 0], [-2, 0]]],
	["tile_1_0/map01/", [[-1, 0], [-1, 0], [-1, 0], [-2, 0], [-2, 0]]],
	["tile/map02/", [[-2, 0], [-2, 0], [-4, 0], [-7, 0], [-12, 0]]],
	["tile_1_0/map02/", [[-2, 0], [-2, 0], [-4, 0], [-7, 0], [-12, 0]]],
	["tile_1_1/map02/", [[-2, 0], [-2, 0], [-4, 0], [-7, 0], [-12, 0]]],
	["tile_1_2/map02/", [[-2, 0], [-2, 0], [-4, 0], [-7, 0], [-12, 0]]],
	["tile_1_2_1/map02/", [[-2, 0], [-2, 0], [-4, 0], [-7, 0], [-12, 0]]]
]

for (const [bp, seeds] of tilesets_pre)
	for (let i = seeds.length; i--;)
		TILESETS.push({
			path: bp + i.toString(),
			seed: seeds[i],
			radius: 80
		})

const OUTROOT = "./saved_tiles",
	RELEASEROOT = "./releases"

const TILE_SIZE = 256,
	CONCURRENT_JOBS = 6

// lazy scaling plz fix later
const DELAY_MIN = 20 * CONCURRENT_JOBS,
	DELAY_MAX = 50 * CONCURRENT_JOBS

const TRANSPARENT_SIZE = 334

function log(...a) {
	return console.log(new Date().toISOString(), ...a)
}

function sleep(ms) {
	return new Promise(r => setTimeout(r, ms))
}

function rand(min, max) {
	return Math.random() * (max - min) + min
}

function isPng(buf) {
	return buf.length >= 8 &&
		buf[0] === 0x89 &&
		buf[1] === 0x50 &&
		buf[2] === 0x4e &&
		buf[3] === 0x47 &&
		buf[4] === 0x0d &&
		buf[5] === 0x0a &&
		buf[6] === 0x1a &&
		buf[7] === 0x0a
}

async function runTileset(cfg) {
	const TILESET = cfg.path,
		[seedX, seedY] = cfg.seed,
		SEARCH_RADIUS = cfg.radius

	log("starting tileset", TILESET)

	const OUTDIR = path.join(OUTROOT, TILESET),
		RELEASEDIR = path.join(RELEASEROOT, TILESET)

	await fs.mkdir(OUTDIR, { recursive: true })
	await fs.mkdir(RELEASEDIR, { recursive: true })

	const META_FILE = path.join(OUTDIR, "meta.json")

	let meta = {}

	try {
		meta = JSON.parse(await fs.readFile(META_FILE, "utf8"))
	} catch {}

	async function saveMeta() {
		await fs.writeFile(META_FILE, JSON.stringify(meta, null, "\t"))
	}

	async function getTile(x, y) {
		const key = `${x},${y}`,
			file = path.join(OUTDIR, `${x}_${y}.png`),
			cached = meta[key]

		// only retry failed requests or process new ones
		if (cached?.status === "transparent" || cached?.status === "missing")
			return cached.status

		try {
			await fs.access(file)
			meta[key] ??= { status: "valid" }
			return "valid"
		} catch {}

		const headers = {}

		if (cached?.etag) headers["If-None-Match"] = cached.etag

		const url = new URL(`${TILESET}/${x}_${y}.png`, BASE).href

		try {
			const res = await fetch(url, { headers })

			if (res.status === 304) return cached?.status ?? "missing"

			if (!res.ok) {
				meta[key] = { status: "missing" }
				return "missing"
			}

			const buf = Buffer.from(await res.arrayBuffer()),
				etag = res.headers.get("etag")

			// server returns 200 and a 404 html page instead of the 404 status
			// good job, HG devs
			if (!isPng(buf)) {
				log("fake", x, y)
				meta[key] = { status: "missing" }
				return "missing"
			}

			if (buf.length === TRANSPARENT_SIZE) {
				log("transparent", x, y)
				meta[key] = { status: "transparent", etag }
				return "transparent"
			}

			await fs.writeFile(file, buf)

			meta[key] = { status: "valid", etag }
			log("got", x, y)
			return "valid"
		} catch (err) {
			log("fail", x, y, err.message)
			return "missing"
		}
	}

	const queue = [[seedX, seedY, 0]],
		seen = new Set(),
		queued = new Set([`${seedX},${seedY}`])

	let activeWorkerCount = 0

	async function worker() {
		while (true) {
			const item = queue.shift()

			if (!item) {
				if (activeWorkerCount === 0) return
				await sleep(50)
				continue
			}

			activeWorkerCount++

			try {
				const [x, y, transparentDepth] = item,
					key = `${x},${y}`

				queued.delete(key)

				if (seen.has(key)) continue
				seen.add(key)

				await sleep(rand(DELAY_MIN, DELAY_MAX))

				const result = await getTile(x, y)

				if (result === "missing") continue

				const dist = Math.abs(x) + Math.abs(y)
				if (dist >= SEARCH_RADIUS) continue

				const nextDepth = transparentDepth + (result === "transparent")
				if (nextDepth > 1) continue

				for (const [nx, ny] of [
					[x + 1, y],
					[x - 1, y],
					[x, y + 1],
					[x, y - 1]
				]) {
					const nkey = `${nx},${ny}`

					if (seen.has(nkey) || queued.has(nkey)) continue
					
					queued.add(nkey)
					queue.push([nx, ny, nextDepth])
				}
			} finally {
				activeWorkerCount--
			}
		}
	}

	await Promise.all(Array.from({ length: CONCURRENT_JOBS }, worker))
	await saveMeta()

	const files = await fs.readdir(OUTDIR),
		tiles = []

	for (const file of files) {
		const m = file.match(/^(-?\d+)_(-?\d+)\.png$/)
		if (!m) continue
		tiles.push([Number(m[1]), Number(m[2])])
	}

	if (!tiles.length) {
		log("no tiles for", TILESET)
		return
	}

	const xs = tiles.map(t => t[0]),
		ys = tiles.map(t => t[1])

	const minX = Math.min(...xs),
		maxX = Math.max(...xs),
		minY = Math.min(...ys),
		maxY = Math.max(...ys)

	const width = (maxX - minX + 1) * TILE_SIZE,
		height = (maxY - minY + 1) * TILE_SIZE

	log("stitching", TILESET, width, "x", height)

	const img = sharp({
		create: {
			width,
			height,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		}
	}).composite(
		tiles.map(([x, y]) => ({
			input: path.join(OUTDIR, `${x}_${y}.png`),
			left: (x - minX) * TILE_SIZE,
			top: (y - minY) * TILE_SIZE
		}))
	)

	await Promise.all([
		img.clone()
			.webp({ lossless: true })
			.toFile(path.join(RELEASEDIR, "map_lossless.webp")),

		img.clone()
			.webp({ nearLossless: true, quality: 90 })
			.toFile(path.join(RELEASEDIR, "map_near_lossless.webp")),

		img.clone()
			.webp({ quality: 90 })
			.toFile(path.join(RELEASEDIR, "map_lossy.webp"))
	])

	log("done", TILESET)
}

for (const cfg of TILESETS)
	await runTileset(cfg)
