import xrpl from 'xrpl'
import EventEmitter from '../../common/events.js'
import { wait } from '../../common/time.js'
import { Logger } from '../lib/log.js'


export default class extends EventEmitter{
	constructor(config){
		super()

		this.log = new Logger({name: 'xrpl', color: 'yellow'})
		this.queue = []
		this.clients = []
		this.seen = []

		for(let spec of config.nodes){
			if(spec.disabled)
				continue

			let connections = spec.connections || 1

			for(let i=0; i<connections; i++){
				let client = new xrpl.Client(spec.url, {timeout: 60000})

				//yes
				client.spec = spec

				client.on('transaction', tx => {
					if(!this.hasSeen(`tx${tx.transaction.hash}`))
						this.emit('transaction', tx)
				})
				client.on('ledgerClosed', ledger => {
					if(ledger.validated_ledgers){
						client.spec.ledgers = ledger.validated_ledgers
							.split(',')
							.map(range => range
								.split('-')
								.map(i => parseInt(i))
							)
					}

					if(!this.hasSeen(`ledger${ledger.ledger_index}`))
						this.emit('ledger', ledger)
				})
				client.on('connected', () => {
					this.printConnections(`${client.spec.url} established`)
					this.subscribeClient(client)
				})
				client.on('disconnected', async code => {
					this.printConnections(`${client.spec.url} disconnected: code ${code}`)
					this.relentlesslyConnect(client)
				})
				client.on('error', error => {
					this.log.error(`${client.spec.url} error: ${error}`)
				})
				

				this.clients.push(client)
				this.relentlesslyConnect(client)
			}
		}

		this.loop()
	}

	hasSeen(key){
		if(this.seen.includes(key))
			return true

		this.seen.push(key)

		if(this.seen.length > 1000)
			this.seen.shift()
	}

	async loop(){
		while(true){
			for(let job of this.queue){
				let bidders = this.clients
					.map(client => ({client, bid: this.bidForJob(client, job)}))
					.filter(({bid}) => bid)
					.sort((a, b) => b.bid - a.bid)
					.map(({client}) => client)

				if(bidders.length === 0)
					continue

				job.started()

				this.doJob(bidders[0], job)
				this.queue = this.queue.filter(j => j !== job)
			}

			await wait(100)
		}
	}

	bidForJob(client, job){
		if(!client.isConnected())
			return

		if(client.spec.busy)
			return null

		let bid = 1 - this.clients.indexOf(client) * 0.001
		let index = job.request.ledger_index

		if(index){
			if(!client.spec.ledgers)
				return 0

			let has = client.spec.ledgers
				.some(([start, end]) => index >= start && index <= end)

			if(!has)
				return 0
		}

		// todo: take latency and node health into account

		return bid
	}

	async doJob(client, job){
		client.spec.busy = true

		try{
			let { result } = await client.request(job.request)

			job.resolve(result)
		}catch(error){
			job.reject(error)
		}

		client.spec.busy = false
	}


	request({priority, ...request}){
		priority = priority || 0

		return new Promise((resolve, reject) => {
			let potentialNodes = this.clients
				.map(client => client.spec)
				.filter(spec => !spec.allowedCommands || spec.allowedCommands.includes(request.command))

			if(request.ledger_index){
				potentialNodes = potentialNodes.filter(spec => spec.ledgers 
					&& spec.ledgers.some(([start, end]) => 
						request.ledger_index >= start && request.ledger_index <= end))
			}

			if(potentialNodes.length === 0){
				setTimeout(() => reject('REQUEST_UNFULLFILLABLE'), 30000)
				return
			}

			let insertAt = this.queue.length - 1
			let timeout = setTimeout(() => reject('NO_NODE_AVAILABLE'), 30000)
			let started = () => clearTimeout(timeout)

			while(insertAt > 0 && priority > this.queue[insertAt].priority){
				insertAt--
			}

			this.queue.splice(insertAt, 0, {priority, request, resolve, reject, started})
		})
	}

	async getCurrentLedger(){
		let result = await this.request({command: 'ledger'})

		return result.ledger || result.closed.ledger
	}

	async subscribeClient(client){
		if(client.spec.allowedCommands && !client.spec.allowedCommands.includes('subscribe'))
			return

		let result = await client.request({
			command: 'subscribe',
			streams: ['ledger', 'transactions']
		})
	}

	async relentlesslyConnect(client){
		while(!client.isConnected()){
			try{
				await client.connect()
			}catch(error){
				await wait(3000)
			}
		}
	}

	printConnections(recent){
		let online = this.clients.filter(client => client.isConnected()).length

		this.log.info(`${online} / ${this.clients.length} clients online ${recent ? `(${recent})` : ''}`)
	}
}