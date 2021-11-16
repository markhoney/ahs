const fs = require('fs');
const path = require('path');
const jBinary = require('jbinary');
const zlib = require('zlib');
const parseString = require('xml2js').parseStringPromise;
const crc32 = require('buffer-crc32');
const ADLER32 = require('adler-32');
const colors = require('colors');

const program = require('commander');
program
	.version('1.0.0')
	.arguments('<file>')
	.option('-e, --extract', 'save extracted files')
	.option('-j, --json', 'save parsed files')
	.option('-o, --overwrite', 'overwrite existing files')
	.option('-c, --checksum', 'print checksums')
	.option('-v, --verbose', 'verbose output')
	.parse(process.argv);

function getTypesets() {
	return {
		bb: {
			'jBinary.all': 'Items',
			'jBinary.littleEndian': true,
			//Items: 'blob',
			Items: 'uint32',
		},

		clist: {
			'jBinary.all': 'Files',
			'jBinary.littleEndian': true,

			File: {
				magic: ['const', ['array', 'uint8', 4], [0x01, 0x34, 0x00, 0x00]],
				padding1: ['const', 'uint16', 0],
				bits: ['array', 'uint8', 2],
				padding2: ['skip', 12],
				name: ['string0', 32],
			},

			Files: ['array', 'File'],
		},

		counters: {
			'jBinary.all': 'Items',
			'jBinary.littleEndian': true,

			Item: {
				id: 'uint16',
				unknown: 'uint16',
				bits: ['array', 'uint8', 2],
				padding1: ['skip', 6],
				value: 'uint32',
				padding2: ['skip', 4],
				name: ['string0', 64],
			},

			Items: {
				magic: ['const', ['array', 'uint8', 4], [0x05, 0x00, 0x00, 0x00]],
				padding: ['skip', 28],
				counter: ['array', 'Item', 6],	
			},
		},

		cust_info: {
			'jBinary.all': 'Items',
			'jBinary.littleEndian': true,

			Items: {
				HPSupportCaseNumber: ['string0', 15],
				ContactName: ['string0', 256],
				PhoneNumber: ['string0', 40],
				Email: ['string0', 256],
				CompanyName: ['string0', 256],
			},
		},

		bcert: {
			'jBinary.all': 'Items',
			'jBinary.littleEndian': true,

			Items: jBinary.Template({
				baseType: 'string',
				read: function() {
					return parseString(this.baseRead()).then(function(result) {
						return result;
					});
				},
			}),
		},

		file: {
			'jBinary.all': 'Item',
			'jBinary.littleEndian': true,
			Item: 'string',
		},

		ahs: {
			'jBinary.all': 'Files',
			'jBinary.littleEndian': true,

			gzip: jBinary.Template({
				params: ['size'],
				setParams: function(size) {
					this.baseType = ['blob', size];
				},
				read: function() {
					try {
						return zlib.gunzipSync(this.baseRead());
					} catch(err) {
						//console.log(err);
					}
				},
			}),

			derived: jBinary.Type({
				params: ['string'],
				read: function() {
					return this.toValue(this.string);
				},
			}),

			FileContents: jBinary.Type({
				params: ['filename', 'data'],
				read: function() {
					let typeset;
					const name = this.toValue(this.filename);
					switch (name) {
						case "clist.pkg":
							typeset = typesets.clist;
							break;
						case "CUST_INFO.DAT":
							typeset = typesets.cust_info;
							break;
						case "bcert.pkg.xml":
							typeset = typesets.bcert;
							break;
						case "counters.pkg":
							typeset = typesets.counters;
							break;
						case "file.pkg.txt":
							typeset = typesets.file;
							break;
						default:
							typeset = typesets[name.split(".")[1]];
					};
					const binary = new jBinary(this.toValue(this.data), typeset);
					return binary.readAll();
				},
			}),

			File: {
				magic: ['const', ['array', 'uint8', 4], [0x41, 0x42, 0x4A, 0x52]], // ABJR
				pad1: ['const', 'uint32', 131584],
				size: 'uint32',
				pad2: ['const', 'uint32', 0],
				bits: ['array', 'uint8', 4],
				name: ['string0', 32],
				newname: ['derived', function(context) {
					return context.name.replace(".zbb", ".bb").replace("bcert.pkg", "bcert.pkg.xml").replace("file.pkg", "file.pkg.txt");
				}],
				jsonname: ['derived', function(context) {
					const name = context.name.split(".");
					name.pop();
					return name + ".json";
				}],
				extension: ['derived', function(context) {
					return context.name.split(".").pop();
				}],
				date: ['derived', function(context) {
					const name = context.name.split(".")
					if (name.pop() == "bb") {
						const parts = name[0].split("-", 2);
						if (parts.length == 2) {
							return parts[1];
						} else if (!name.includes("_")) {
							return "20" + name.slice(5,6) + "-" + name.slice(1,2) + "-" + name.slice(3,4);
						}
					}
				}],
				id: ['derived', function(context) {
					const name = context.name.split(".")
					if (name.pop() == "bb") {
						const parts = name[0].split("-", 2);
						if (parts.length == 2) {
							return parseInt(parts[0]).toString();
						}
					}
				}],
				large: ['blob', 60],
				checksum: 'uint32',
				data: [
					'if',
					function(context) {
						return context.name == "bcert.pkg" || context.name.endsWith(".zbb");
					},
					//['binary', 'size', gzip],
					['gzip', 'size'],
					['blob', 'size'],
				],
				contents: [
					'if',
					function(context) {
						return context.data;
					},
					['FileContents', 'newname', 'data'],
				],
				crc32: [
					'if',
					function(context) {
						return context.data;
					},
					['derived', function(context) {
						return crc32.unsigned(context.data);
					}],
				],
				adler32: [
					'if',
					function(context) {
						return context.adler32_signed;
					},
					['derived', function(context) {
						return (new Uint32Array([context.adler32_signed]))[0];
					}],
				],
				fletcher32: [
					'if',
					function(context) {
						return context.data;
					},
					['derived', function(context) {
						return fletcher32(context.data);
					}],
				],
				fnv32_0: [
					'if',
					function(context) {
						return context.data;
					},
					['derived', function(context) {
						return fnv32(context.data, 0);
					}],
				],
				fnv32_1: [
					'if',
					function(context) {
						return context.data;
					},
					['derived', function(context) {
						return fnv32(context.data, 1);
					}],
				],
				fnv32_2: [
					'if',
					function(context) {
						return context.data;
					},
					['derived', function(context) {
						return fnv32(context.data, 2);
					}],
				],
				size_decompressed: [
					'if',
					function(context) {
						return context.data;
					},
					['derived', function(context) {
						return context.data.length;
					}],
				],
			},

			Files: ['array', 'File'],
		}
	};
}

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

function fletcher32(data) {
	var _sum1 = 0xffff, _sum2 = 0xffff;
	var words = data.length;
	var dataIndex = 0;
	while (words) {
			var tlen = words > 359 ? 359 : words;
			words -= tlen;
			do {
					_sum2 += _sum1 += data[dataIndex++];
			} while (--tlen);
			_sum1 = ((_sum1 & 0xffff) >>> 0) + (_sum1 >>> 16);
			_sum2 = ((_sum2 & 0xffff) >>> 0) + (_sum2 >>> 16);
	}
	_sum1 = ((_sum1 & 0xffff) >>> 0) + (_sum1 >>> 16);
	_sum2 = ((_sum2 & 0xffff) >>> 0) + (_sum2 >>> 16);
	return ((_sum2 << 16) >>> 0 | _sum1) >>> 0;
}

function fnv32(data, mode = 2) {
	var hash = mode ? 0x811c9dc5 : 0;
	for (var i = 0; i < data.length; i++) {
			(mode == 2) && (hash ^= data[i]);
			hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	(mode < 2)  && (hash ^= data[i]);
}
return hash >>> 0;
}

if (program.args.length) {
	const filename = path.resolve(program.args[0]);
	if (fs.existsSync(filename)) {
		var typesets = getTypesets();
		jBinary.load(filename, typesets.ahs).then(function(binary) {
			const files = binary.readAll();
			if (program.verbose) {
				files.forEach(file => {
				 console.log("Found file".green, file.name);
				});
			}
			const dir = filename.split(".")[0];
			if ((program.extract || program.json) && !fs.existsSync(dir)) fs.mkdirSync(dir);
			if (program.extract) {
				files.forEach(file => {
					if (file.data) {
						const newfile = path.join(dir, file.newname);
						if (program.overwrite || !(fs.existsSync(newfile))) {
							writeFile(newfile, file.data);
							if (program.verbose) console.log("Written file".green, file.newname);
						} else {
							if (program.verbose) console.log("Skipped writing file".yellow, file.newname);
						}
					} else {
						console.log("Couldn't read data for".red, file.name);
					}
				});
				console.log("Files written to".blue, dir);
			}
			if (program.json) {
				files.forEach(file => {
					if (file.contents) {
						const jsonfile = path.join(dir, file.jsonname);
						if (program.overwrite || !(fs.existsSync(jsonfile))) {
							writeFile(jsonfile, JSON.stringify(file.contents));
							if (program.verbose) console.log("Written file".green, file.jsonname);
						} else {
							if (program.verbose) console.log("Skipped writing file".yellow, file.jsonname);
						}
					} else {
						console.log("Couldn't parse contents for".red, file.name);
					}
				});
				console.log("Files written to".blue, dir);
			}
			if (program.checksum) {
				console.log("Internal Checksum", "=>", ["FNV32 0", "FNV32 1", "FNV32 2", "Fletcher32", "CRC32", "Adler32"].join(", "), "(Filename)");
				files.forEach(file => {
					if (file.contents) {
						console.log(file.checksum, "=>", [file.fnv32_0, file.fnv32_1, file.fnv32_2, file.fletcher32, file.crc32, file.adler32].join(", "), "(" + file.name + ")");
					}
				});
			}
		});
	} else {
		console.log("\nError: File does not exist\n".red);
		program.outputHelp();
	}
} else {
	console.log("\nError: No filename given\n".red);
	program.outputHelp();
}