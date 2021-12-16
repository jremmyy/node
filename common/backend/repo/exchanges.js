import Decimal from '../../lib/decimal.js'
import { serialize, deserialize } from '../../lib/decimal.io.js'
import codec from 'ripple-address-codec'


export function init(){
	this.exec(
		`CREATE TABLE IF NOT EXISTS "Exchanges" (
			"id"		INTEGER NOT NULL UNIQUE,
			"hash"		BLOB NOT NULL,
			"maker"		BLOB NOT NULL,
			"taker"		BLOB NOT NULL,
			"sequence"	INTEGER NOT NULL,
			"ledger"	INTEGER NOT NULL,
			"base"		INTEGER,
			"quote"		INTEGER,
			"price"		BLOB NOT NULL,
			"volume"	BLOB NOT NULL,
			PRIMARY KEY ("id")
			UNIQUE ("hash", "taker", "sequence")
		);

		CREATE INDEX IF NOT EXISTS 
		"ExchangesBase" ON "Exchanges" 
		("base");

		CREATE INDEX IF NOT EXISTS 
		"ExchangesQuote" ON "Exchanges" 
		("quote");`
	)
}

export function insert(exchanges){
	this.insert({
		table: 'Exchanges',
		data: exchanges.map(exchange => {
			let hash = Buffer.from(exchange.hash, 'hex')
			let maker = codec.decodeAccountID(exchange.maker)
			let taker = codec.decodeAccountID(exchange.taker)
			let base = this.trustlines.id(exchange.base)
			let quote = this.trustlines.id(exchange.quote)
			let price = serialize(new Decimal(exchange.price))
			let volume = serialize(new Decimal(exchange.volume))

			return {
				hash: hash.slice(0, 4),
				maker: maker.slice(0, 4),
				taker: taker.slice(0, 4),
				sequence: exchange.sequence,
				ledger: exchange.ledger,
				base,
				quote,
				price,
				volume
			}
		}),
		duplicate: 'ignore'
	})
}

export function* iter({base, quote, from, to} = {}){
	let where = '1'

	if(base || quote){
		where = `"base" IS @base AND "quote" IS @quote`
	}else if(from || to){
		where = `id >= @from AND id <= @to`
	}

	let iter = this.iterate(
		`SELECT Exchanges.id, ledger, base, quote, price, volume, date 
		FROM Exchanges
		INNER JOIN Ledgers ON (Ledgers."index" = Exchanges.ledger) 
		WHERE ${where}`, 
		{base, quote, from, to}
	)

	for(let exchange of iter){
		yield decode(exchange)
	}
}

/*
export function all({base, quote, from, to}){
	let rows = []

	if(base || quote){
		let baseId = base ? this.trustlines.id(base) : null
		let quoteId = quote ? this.trustlines.id(quote) : null
		
		rows = this.all(
			`SELECT Exchanges.id, ledger, base, quote, price, volume, date
			FROM Exchanges 
			INNER JOIN Ledgers ON (Ledgers."index" = Exchanges.ledger)
			WHERE \`base\` IS ? 
			AND \`quote\` IS ?`, 
			baseId,
			quoteId
		)
	}else if(from || to){
		rows = this.all(
			`SELECT Exchanges.id, ledger, base, quote, price, volume, date 
			FROM Exchanges
			INNER JOIN Ledgers ON (Ledgers."index" = Exchanges.ledger) 
			WHERE id >= ? AND id <= ?`, 
			from, 
			to
		)
	}

	return rows.map(exchange => decode(exchange))
}*/

export function decode(exchange){
	return {
		...exchange,
		price: deserialize(exchange.price),
		volume: deserialize(exchange.volume)
	}
}

export function align(exchange, base, quote){
	if(exchange.base === base){
		return {
			id: exchange.id,
			ledger: exchange.ledger,
			date: exchange.date,
			price: exchange.price,
			volume: Decimal.mul(exchange.volume, exchange.price)
		}
	}else if(exchange.base === quote){
		return {
			id: exchange.id,
			ledger: exchange.ledger,
			date: exchange.date,
			price: Decimal.div('1', exchange.price),
			volume: exchange.volume
		}
	}else{
		throw 'unexpected base/quote pair'
	}
}

export function invert(exchanges){
	return {
		id: exchange.id,
		ledger: exchange.ledger,
		date: exchange.date,
		price: Decimal.div('1', exchange.price),
		volume: Decimal.mul(exchange.volume, exchange.price)
	}
}

export function pairs(){
	return this.all(`SELECT DISTINCT base, quote FROM Exchanges`)
}

export function count(){
	return this.getv(`SELECT COUNT(1) FROM Exchanges`)
}