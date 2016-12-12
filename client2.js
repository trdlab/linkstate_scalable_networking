var server_port = 6662;
var server_addr = '127.0.0.1';

var seqNo = 0;

var address = "Client2";
var destination = "Client1";

var debug = false;

var dgram = require('dgram');
var _ = require('lodash');

var client = dgram.createSocket('udp4');

function send_msg(msg) {
	client.send(msg, 0, msg.length, server_port, server_addr, function(err, bytes) {
		if (err) throw err;
		if (debug) {
			console.log('UDP message sent to ' + server_addr +':'+ server_port);
		}
		    
	});
}

client.on('message', function (msg) {
	var msg_rcv = JSON.parse(msg);
	var seq = msg_rcv.seq;
	var source = msg_rcv.src;
	var destination = msg_rcv.dest;
	var payload = msg_rcv.payload;
	var type = msg_rcv.type;

	if (debug) {
		console.log(JSON.stringify(msg_rcv));
	}

	if (type != "ACK") {
		if (!debug) {
			console.log('Message From : ' + source + ' is "' + payload + '"')
		}
		var ack_msg = new Buffer(JSON.stringify({seq: seqNo++, type: 'ACK', src: address, dest: "", payload:seq}));
		send_msg(ack_msg);
	}

});

var stdin = process.openStdin();

stdin.addListener("data", function(d) {
	var inputs = _.split(d.toString().trim(), ' ', 2);
	if (inputs.length < 1) {
		console.log('invalid command!')
		return;
	}
	switch(inputs[0]) {
		case 'SEND':
			if (inputs[1] == undefined) {
				console.log('invalid command!')
				return;
			}
			var msg = new Buffer(JSON.stringify({seq: seqNo++, type: 'SEND', src: address, dest: destination, payload:inputs[1]}));
			send_msg(msg);
			break;
		case 'GET':
			var msg = new Buffer(JSON.stringify({seq: seqNo++, type: 'GET', src: address, dest: "", payload:{}}));
			send_msg(msg);
			break;
		default:
        		console.log('invalid command!');
	}
});


