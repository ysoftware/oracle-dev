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
let interval = 10 * 60 * 1000

// data

let endpoints = [
	"http://jungle2.cryptolions.io"
]

let btc_usd = [
	["https://www.bitinka.com/api/apinka/ticker/BTC_USD?format=json", "USD/0/lastPrice"],
	["https://api.pro.coinbase.com/products/BTC-USD/ticker", "price"],
	["https://it.bitstamp.net/api/v2/ticker/btcusd", "last"],
	["https://api.gemini.com/v1/pubticker/btcusd", "last"],
	["https://data.messari.io/api/v1/assets/btc/metrics", "data/market_data/price_usd"]
]

let eos_btc = [
	["https://poloniex.com/public?command=returnTicker", "BTC_EOS/last"],
	["https://api.binance.com/api/v1/ticker/24hr?symbol=EOSBTC", "lastPrice"]
]

let eos_usd = [
	["https://www.bitinka.com/api/apinka/ticker/EOS_USD?format=json", "EOS/0/lastPrice"],
	["https://api.kraken.com/0/public/Ticker?pair=EOSUSD", "result/EOSUSD/c/0"],
	["https://api.pro.coinbase.com/products/EOS-USD/ticker", "price"]
]

// methods

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
	catch (e) { console.log(`Transaction failed: ${e.message}`.red); return undefined }
}

async function download(url) {
	if (url === undefined) { return undefined }
	try { return await (await fetch(url)).json() }
	catch (e) { console.log(`Downloading: ${url}`.gray); console.log(`Error: ${e.message}`.yellow); return undefined }
}

async function unpack(object, path) {
	if (object === undefined) { return undefined }
	try {
		let turns = path.split("/")
		var value = object
		for (i in turns) { value = value[turns[i]] }
		return parseFloat(value)
	}
	catch (e) { console.log(`Unpack error: ${e.message}`.yellow); console.log(object); return undefined }
}

async function getPrices(providers) {
	return (await map(providers, async provider => { return await getPrice(provider) }))
		.filter(element => { return element !== undefined })
}

async function pushRun(url) {
	console.log(`Pushing run`.green)
	try {
		let api = getApi(url)
		let result = await api.transact({
			actions: [{ account: 'scrugeosbuck', name: 'run', 
				authorization: [{ actor: 'scrugeoracle', permission: 'active' }],
			data: { max: 50 },
			}]}, { blocksBehind: 3, expireSeconds: 30 })
		return result.transaction_id
	}
	catch (exception) {
		console.error(`Transaction error: ${exception.message}`.red)
		return undefined
	}
}

async function pushUpdate(price, url) {
	console.log(`Pushing price: ${price}`.green)
	try {
		let api = getApi(url)
		let result = await api.transact({
			actions: [{ account: 'scrugeosbuck', name: 'update', 
				authorization: [{ actor: 'scrugeosbuck', permission: 'oracle' }],
			data: { eos_price: 10000 },
			}]}, { blocksBehind: 3, expireSeconds: 30 })
		return result.transaction_id
	}
	catch (exception) {
		console.error(`Transaction error: ${exception.message}`.red)
		return undefined
	}
}

// entry point

async function main() {
	let deltaTime = new Date().getTime() - loadTime()
	let delay = Math.max(0, Math.min(interval, interval - deltaTime))
	console.log(`Restarting with initial delay: ${delay}`.blue)
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

	let btcusd_result = await getPrices(btc_usd)
	let eosbtc_result = await getPrices(eos_btc)
	let eosusd_result = await getPrices(eos_usd)

	let btcusd = median(btcusd_result)
	let eosbtc = median(eosbtc_result)
	let eosusd = median(eosusd_result)

	let result = median([btcusd * eosbtc, eosusd])
	console.log(`Fetched price: ${result}`.blue)

	let prepared = parseInt(result * 100)
	let updateId = await pushUpdate(prepared, endpoints[0])

	if (updateId !== undefined) {
		console.log(`Transaction id: ${updateId}`.white)

		let runId = await pushRun(endpoints[0])
		if (runId !== undefined) {
			console.log(`Transaction id: ${runId}`.white)
		}
	}

	saveTime(date)
	console.log("\n\n")
}

main()