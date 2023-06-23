import run from '../../../src/crawl/crawlers/tokenlists.js'
import { open as openDB } from '../../../src/db/index.js'


export default async ({ config }) => {
	let ctx = { config }

	Object.assign(ctx, {
		db: openDB({ ctx })
	})

	await run({ ctx })
}