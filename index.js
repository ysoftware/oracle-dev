let { Api, JsonRpc, RpcError } = require('eosjs')
let { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig')      // development only
let fetch = require('node-fetch')                                    // node only; not needed in browsers
let { TextEncoder, TextDecoder } = require('util')                   // node only; native TextEncoder/Decoder
let { map } = require('p-iteration')
let colors = require('colors')
let dateFormat = require('dateformat')
let fs = require('fs')
require('https').globalAgent.options.ca = require('ssl-root-cas/latest').create()

let defaultPrivateKey = "5JBfxHwj6VLAGRiQetZxH672EhJx1rKNBHZrUo1Dy4miEbxfHAx"
let signatureProvider = new JsSignatureProvider([defaultPrivateKey])
let interval = 1 * 60 * 1000
let endpoints = loadEndpoints()

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

function median(values) {
	if (values.length === 0) return 0
	values.sort((a, b) => { return a - b })
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
	catch (e) { console.log(`Unpack error: "${e.message}"`.yellow); console.log(object); return undefined }
}

async function getPrices(providers) {
	return (await map(providers, async provider => { return await getPrice(provider) }))
		.filter(element => { return element !== undefined })
}

async function pushRun(endpoint, data) {
	console.log(`Pushing run @ ${endpoint}…`.green)

	let api = getApi(endpoint)
	let result = await api.transact({
		actions: [{ account: 'scrugeosbuck', name: 'run',
			authorization: [{ actor: 'scrugeoracle', permission: 'active' }],
		data: { max: 50 },
		}]}, { blocksBehind: 3, expireSeconds: 15 })
	return result.transaction_id
}

async function pushUpdate(endpoint, data) {
	console.log(`Pushing update with price: ${data} @ ${endpoint}…`.green)

	let api = getApi(endpoint)
	let result = await api.transact({
		actions: [{ account: 'scrugeosbuck', name: 'update',
			authorization: [{ actor: 'scrugeosbuck', permission: 'oracle' }],
		data: { eos_price: data },
		}]}, { blocksBehind: 3, expireSeconds: 15 })
	return result.transaction_id
}

async function tryTransaction(func, data=undefined, endpoint=0) {
	let url = endpoints.eos[endpoint]
	if (url === undefined) { throw Error("Transaction failed on all endpoints") }
	try { return await func.call(null, url, data) }
	catch (e) {
		console.error(`Transaction error: "${e.message}"`.yellow)
		return tryTransaction(func, data, endpoint+1)
	}
}

// entry point

async function main() {
	loadEndpoints()
	let deltaTime = new Date().getTime() - loadTime()
	let delay = Math.max(0, Math.min(interval, interval - deltaTime))
	console.log(`Restarting with initial delay: ${parseInt(delay / 1000)} sec…`.blue)
	setTimeout(init, delay)
}

async function init() {
	setInterval(collect, interval)
	collect()
}

async function collect() {
	let date = new Date()
	console.log(`\nStarting…`.green)
	console.log(dateFormat(date, "H:MM:ss, mmmm dS yyyy").green)

	let btcusd_result = await getPrices(endpoints.btc_usd)
	let eosbtc_result = await getPrices(endpoints.eos_btc)
	let eosusd_result = await getPrices(endpoints.eos_usd)

	let btcusd = median(btcusd_result)
	let eosbtc = median(eosbtc_result)
	let eosusd = median(eosusd_result)

	let result = median([btcusd * eosbtc, eosusd])
	console.log(`Fetched price: ${result}\n`.blue)

	let price = parseInt(result * 100)

	try {
		let updateId = await tryTransaction(pushUpdate, price)
		console.log(`Transaction id: ${updateId}\n`.white)

		saveTime(date)

		try {
			let runId = await await tryTransaction(pushRun)
			console.log(`Transaction id: ${runId}\n`.white)
			console.log("Update complete.".green)
		}
		catch (e) {
			console.log(`\nUpdate went through, but run action failed: "${e.message}".`.yellow)
		}
	}
	catch (e) {
		console.log(`Update failed: "${e.message}".`.red)
	}
	console.log("\n\n")
}

main()