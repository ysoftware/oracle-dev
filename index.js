let { Api, JsonRpc, RpcError } = require('eosjs')
let { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig')      // development only
let fetch = require('node-fetch')                                    // node only; not needed in browsers
let { TextEncoder, TextDecoder } = require('util')                   // node only; native TextEncoder/Decoder
let { map } = require('p-iteration')
let colors = require('colors')
let dateFormat = require('dateformat')
let fs = require('fs')
require('https').globalAgent.options.ca = require('ssl-root-cas/latest').create()

// EOS5y6r4yQvT6MTUVNDx1S5V4QVaV5NkmB88pVREqBbYtTneH8oQ4
let contract = "buckprotocol"
let defaultPrivateKey = ""
let signatureProvider = new JsSignatureProvider([defaultPrivateKey])
let interval = 5 * 60 * 1000
let endpoints = loadEndpoints()

function isValid(number) {
	return !isNaN(number) && number !== undefined && number !== null
}

function loadEndpoints() {
	let contents = fs.readFileSync("endpoints.json", 'utf8')
	return JSON.parse(contents)
}

function loadTime() {
	let contents = fs.readFileSync("update.txt", 'utf8')
	let time = parseInt(contents)
	if (time === NaN) { console.log(`Could not parse file: ${e.message}`.red); return 0 }
	return time
}

function saveTime(date) {
	let contents = date.getTime().toString()
	fs.writeFileSync("update.txt", contents, (e) => {
		if (e) { console.log(`Error saving file: ${e.message}`.red) }
	})
}

function getApi(url) {
	let rpc = new JsonRpc(url, { fetch })
	return new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() })
}

function median(v) {
	values = v
		.filter(number => { return isValid(number) })
		.sort((a, b) => { return a - b })
	if (values.length === 0) return undefined
	var half = Math.floor(values.length / 2)
	if (values.length % 2) return values[half]
	return (values[half - 1] + values[half]) / 2.0
}

async function getPrice(provider) {
	try { return unpack(await download(provider[0]), provider[1]) }
	catch (e) { console.log(`Transaction failed: "${e.message}"`.red); return undefined }
}

async function download(url) {
	if (url === undefined) { return undefined }
	try { return await (await fetch(url)).json() }
	catch (e) { console.log(`Downloading: ${url}`.gray); console.log(`Error: "${e.message}"`.yellow); return undefined }
}

async function unpack(object, path) {
	if (object === undefined) { return undefined }
	try {
		let turns = path.split("/")
		var value = object
		for (i in turns) { value = value[turns[i]] }
		return parseFloat(value)
	}
	catch (e) { console.log(`Unpack error: "${e.message}"`.yellow); console.log("Object in question:".yellow); console.log(object); console.log("\n"); return undefined }
}

async function getPrices(providers) {
	return (await map(providers, async provider => { return await getPrice(provider) }))
		.filter(element => { return element !== undefined })
}

async function tryTransaction(action, actor, permission, data, endpoint=0) {
	let url = endpoints.eos[endpoint]
	console.log(`Pushing ${action} @ ${url}…`.green)
	if (url === undefined) { return Error("Transaction failed on all endpoints") }
	try {
		let api = getApi(url)
		let result = await api.transact({
			actions: [{ account: contract, name: action,
				authorization: [{ actor: actor, permission: permission }],
			data: data,
			}]}, { blocksBehind: 3, expireSeconds: 15 })
		console.log(`Transaction id: ${result.transaction_id}`.white)
		console.log(`CPU usage: ${result.processed.receipt.cpu_usage_us} μs\n`.gray)
		return result
	}
	catch (e) {
		console.error(`Transaction error: "${e.message}"`.yellow)
		return tryTransaction(action, actor, permission, data, endpoint+1)
	}
}

async function collect() {
	let date = new Date()
	console.log(`\nStarting…`.green)
	console.log(dateFormat(date, "H:MM:ss, mmmm dS yyyy").green)

	let btcusd_result = await getPrices(endpoints.btc_usd)
	let eosbtc_result = await getPrices(endpoints.eos_btc)
	let eosusd_result = await getPrices(endpoints.eos_usd)

	let count = btcusd_result.length + eosbtc_result.length + eosusd_result.length

	let btcusd = median(btcusd_result)
	let eosbtc = median(eosbtc_result)
	let eosusd = median(eosusd_result)
	let result = median([btcusd * eosbtc, eosusd])
	let price = Math.round(result * 100)

	if (isValid(price)) {
		console.log(`Fetched ${count} prices: ${price} (${result})\n`.blue)

		let updateResult = await tryTransaction('update', contract, 'oracle', { eos_price: price })
		if (updateResult instanceof Error) {
			console.log(`Update completely failed: "${updateResult.message}".`.red)
			return
		}

		saveTime(date)

		let runResult = await tryTransaction('run', 'scrugeoracle', 'active', { max: 50 })
		if (runResult instanceof Error) {
			console.log(`\nUpdate went through, but run action failed: "${runResult.message}".`.yellow)
			return
		}
		console.log("Update complete.".green)
	}
	else { console.log(`Price fetch completely failed: "${price}".`.red) }

	console.log("________________________________________________________________________________".green)
}

async function init() {
	setInterval(collect, interval)
	collect()
}

async function main() {
	loadEndpoints()
	let deltaTime = new Date().getTime() - loadTime()
	let delay = Math.max(0, Math.min(interval, interval - deltaTime))
	console.log(`Restarting with initial delay: ${parseInt(delay / 1000)} sec…`.blue)
	setTimeout(init, delay)
}

main()