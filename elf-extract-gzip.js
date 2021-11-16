const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function writeFile(name, data) {
	fs.open(name, 'w', function(err, fd) {
		if (!err) {
			fs.write(fd, data, 0, data.length, null, function(err) {
				if (!err) {
					fs.close(fd, () => {});
				}
			});
		}
	});
}

if (process.argv.length > 2) {
	const filename = path.resolve(process.argv[2]);
	if (fs.existsSync(filename)) {

		const magic = Buffer.from('1F8B', 'hex');
		const zero = Buffer.from('00', 'hex');

		const buffer = fs.readFileSync(filename);
		const files = [];
		let start = buffer.indexOf(magic);

		const dir = filename + "_files";
		if (!fs.existsSync(dir)) fs.mkdirSync(dir);

		while (start < buffer.length) {
			const filenamestart = start + 10;
			const filenameend = buffer.indexOf(zero, filenamestart);
			let file = buffer.toString('utf8', filenamestart, filenameend);
			let end = buffer.indexOf(magic, start + 1) - 1;
			if (end == -2) end = buffer.length;
			
			if (["cab", "css", "svg", "json", "html", "zip", "gif", "ico", "jpg", "js", "png", "woff", "xml", "zlib"].some((ext) => file.endsWith("." + ext))) {
				files.push({start: start, end: end, length: end - start, unsure: buffer.readUInt32LE(end - 4), name: file});
			}
			start = end + 1;
		}
		files.forEach(file => {
			/*zlib.unzip(buffer.slice(file.start, file.end), (err, buf) => {
				if (err) {
					console.log(err);
				} else {
					//writeFile(path.join(dir, file.name), buf);
				}
			});*/
			writeFile(path.join(dir, file.name + ".gz"), buffer.slice(file.start, file.end));
	});
	}
}