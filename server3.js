var seqNo = 0;
var port = 6663; // UDP port to listen
var msg_buffer = []; // Just for directly connected client messages
var ack_wait_buffer = []; // ACK waiting buffer for all UDP messages
var address = "Server3"; // Address of Server for internal addressing
var clients = {"Client1": "Server1", "Client2": "Server2", "Client3": "Server3"} // Clients and Servers mapping
var prev_neig = "Server2"; // Neighbour mapping
var next_neig = null;
var own_lsp = {src: "Server3", val: {"Server2":1}}; // Based on Hoop Count
var lsps = [{S:"Server3", T:"Server2", H:1, C:0}]; // Received LSP list
var forward_table = {}; // Forward Table generated from LSP list by dijkstra
var routers = {"Server1": {addr: "127.0.0.1", port: "6661"}, "Server2": {addr: "127.0.0.1", port: "6662"}, "Server3": {addr: "127.0.0.1", port: "6663"}} // Server internal addressing - ip and port mapping

var dijkstra = require('./dijkstra.js');
var dgram = require('dgram');
var _ = require('lodash');

var server = dgram.createSocket('udp4'); // It creates ipv4 udp server socket!

function lsp_flooding() { // Runs every 20 secs
	// Create LSP based on Hoop count and flood to the prev and next routers
	// We assume that nodes and topology is same. So we didnt create any lsp measuring mechanism like echo delay, etc.
	if (prev_neig != null) {
		var lsp_msg = {seq: seqNo++, type: 'LSP', src: address, dest: prev_neig, payload:own_lsp};
		var lsp_msg_str = new Buffer(JSON.stringify(lsp_msg));
		ack_wait_buffer[ack_wait_buffer.length] = lsp_msg;
		var server_addr = routers[prev_neig].addr;
		var server_port = routers[prev_neig].port;
		send(lsp_msg_str, server_addr, server_port);
	}
	if (next_neig != null) {
		var lsp_msg = {seq: seqNo++, type: 'LSP', src: address, dest: next_neig, payload:own_lsp};
		var lsp_msg_str = new Buffer(JSON.stringify(lsp_msg));
		ack_wait_buffer[ack_wait_buffer.length] = lsp_msg;
		var server_addr = routers[next_neig].addr;
		var server_port = routers[next_neig].port;
		send(lsp_msg_str, server_addr, server_port);
	}
	setTimeout(lsp_flooding, 20000);
}

function update_forward_table() { // Runs every 20 secs, keep delay 10 sec for lsp_flooding
	// Create source/sink tree
	var keys = _.keys(_.groupBy(lsps, 'S'));
	keys = _.concat(keys, 	_.keys(_.groupBy(lsps, 'T')));
	var vertexes = _.map(keys, function(x) {
		return _.map(keys, function(y){
			var t = _.find(lsps, function(z) {
				return z.S == x && z.T == y;
			});
			return t == undefined ? Infinity : t.H;
		});
	});
	console.log(vertexes);
	// Run dijkstra and update forwarding table
	var shortestPathInfo = dijkstra.shortestPath(vertexes, keys.length, _.indexOf(keys, address));
	var i = 0;
	forward_table = _.zipObject(keys, _.map(keys, function(k) {
		return keys[dijkstra.constructPath(shortestPathInfo, i++)[0]];
	}));
	forward_table = _.omit(forward_table, [address]);
	console.log(forward_table);
	setTimeout(update_forward_table, 20000);
}

function send(msg, remote_addr, remote_port) {
	server.send(msg, 0, msg.length, remote_port, remote_addr, function(err, bytes) {
	    if (err) throw err;
	    console.log('UDP message sent to ' + remote_addr +':'+ remote_port);
	});
}

server.on('listening', function () {
    	var address = server.address();
    	console.log('UDP Server listening on ' + address.address + ":" + address.port);
});

server.on('message', function (message, remote) {
    	console.log(remote.address + ':' + remote.port +' - ' + message);
	var msg_rcv = JSON.parse(message);
	var seq = msg_rcv.seq;
	var source = msg_rcv.src;
	var destination = msg_rcv.dest;
	var payload = msg_rcv.payload;
	switch(msg_rcv.type) {
		case 'SEND':
			var ack_msg = new Buffer(JSON.stringify({seq: seqNo++, type: 'ACK', src: address, dest: "", payload:seq}));
			send(ack_msg, remote.address, remote.port);
			if (clients[destination] != address) {
				// Look at the forwarding table and send to next destination
				var next = forward_table[clients[destination]]; // Next router
				var server_addr = routers[next].addr;
				var server_port = routers[next].port;
				
				// Send Message wait for ack!
				ack_wait_buffer[ack_wait_buffer.length] = msg_rcv;
				var msg_str = new Buffer(JSON.stringify(msg_rcv));
				send(msg_str, server_addr, server_port);
			} else {
				msg_buffer[msg_buffer.length] = msg_rcv;
			}
			break;
		case 'GET':
			var ack_msg = new Buffer(JSON.stringify({seq: seqNo++, type: 'ACK', src: address, dest: "", payload:seq}));
			send(ack_msg, remote.address, remote.port);
			var msgs_for_client = _.filter(msg_buffer, function(msg) { return msg.dest == source;});
			_.remove(msg_buffer, function(msg) { return msg.dest == source;});
			_.each(msgs_for_client, function(msg) {
				ack_wait_buffer[ack_wait_buffer.length] = msg;
				var msg_str = new Buffer(JSON.stringify(msg));
				send(msg_str, remote.address, remote.port);
			});
			break;
		case 'LSP':
			var ack_msg = new Buffer(JSON.stringify({seq: seqNo++, type: 'ACK', src: address, dest: 0, payload:seq}));
			send(ack_msg, remote.address, remote.port);

			// Aging LSP records
			_.each(lsps, function(x) {
				if (x.S != address)
					x.C++;
			});

			_.remove(lsps, function(x) {
				return x.C > 10; // Timeout for link
			});
						
			// Update LSP list with received!
			_.forIn(payload.val, function(value, key){
				var x = _.find(lsps, function(y) { return y.S == payload.src && y.T == key; });
				if (x != undefined) {
					x.H = value;	
					x.C = 0;
				} else {
					lsps[lsps.length] = {S:payload.src, T:key, H:value, C:0};
				}
			});
			console.log(lsps);
			break;
		case 'ACK':
			_.remove(ack_wait_buffer, function(msg) { return msg.dest == source && msg.seq == payload;});
			break;
	}
});

server.bind(port);
setTimeout(lsp_flooding, 10000);
setTimeout(update_forward_table, 20000);
