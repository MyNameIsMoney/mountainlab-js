exports.cmd_prv_locate=cmd_prv_locate;
exports.cmd_prv_create=cmd_prv_create;
exports.prv_locate=prv_locate;
exports.prv_create=prv_create;
exports.compute_file_sha1=compute_file_sha1;

var common=require(__dirname+'/common.js');
var db_utils=require(__dirname+'/db_utils.js');
var sha1=require('node-sha1');

function cmd_prv_locate(prv_fname,opts,callback) {
	prv_locate(prv_fname,function(err,path) {
		if (err) {
			console.error(err);
			callback(err);
			return;
		}
		if (path) {
			console.log (path);
			callback('',path);
			return;
		}
		else {
			console.err ('Unable to locate file.');
			callback(null,path);
			return;
		}
	});
}

function cmd_prv_create(fname,prv_fname_out,opts,callback) {
	if (!prv_fname_out) prv_fname_out=fname+'.prv';
	if ((!opts.stat)&&(!opts.sha1))
		console.log ('Creating prv record for file ... : '+fname);
	prv_create(fname,function(err,obj) {
		if (err) {
			console.error(err);
			callback(err);
			return;
		}
		if (obj) {
			if (opts.stat) {
				console.log (JSON.stringify(obj,null,4));
				callback('',obj);
				return;
			}
			if (opts.sha1) {
				console.log (obj.original_checksum);
				callback('',obj.original_checksum);
				return;
			}
			console.log ('Writing prv file ... : '+prv_fname_out);
			if (common.write_text_file(prv_fname_out, JSON.stringify(obj,null,4))) {
				console.log ('Done.')	
			}
			else {
				var err='Unable to write output file.';
				console.error(err);
				callback(err);
				return;
			}
			callback('',obj);
			return;
		}
		else {
			var err='Unable to create prv object.';
			console.err (err);
			callback(err);
			return;
		}
	});
}

function prv_locate(prv_fname,callback) {
	var obj=common.read_json_file(prv_fname);
	if (!obj) {
		callback('Cannot read json file: '+prv_fname);
		return;
	}
	var prv_search_paths=get_prv_search_paths();

	var sha1=obj.original_checksum||'';
	var fcs=obj.original_fcs||'';
	var size=obj.original_size||'';
	if (!sha1) {
		callback('original_checksum field not found in prv file: '+prv_fname);
		return;
	}
	sumit.find_doc_by_sha1(sha1,prv_search_paths,function(err,doc0) {
		if (err) {
			callback(err);
			return;
		}
		if (doc0) {
			callback('',doc0.path);
			return;
		}
		if ((!sha1)||(!size)||(!fcs)) {
			callback('Missing fields in prv file: '+prv_fname);
			return;
		}

		common.foreach_async(prv_search_paths,function(ii,path0,cb) {
			prv_locate_in_path(path0,sha1,fcs,size,function(err,fname) {
				if (err) {
					callback(err);
					return;
				}
				if (fname) {
					callback('',fname);
					return;
				}
				cb();
			});
		},function() {
			callback('',''); //not found
		});
	});
}

function prv_create(fname,callback) {
	var stat0=common.stat_file(fname);
	if (!stat0) {
		callback('Unable to stat file: '+fname);
		return;
	}
	compute_file_sha1(fname,function(err,sha1) {
		if (err) {
			callback(err);
			return;
		}
		var sha1_head=compute_sha1_of_head(fname,1000);
		var fcs='head1000-'+sha1_head;
		var obj={
			original_checksum:sha1,
			original_size:stat0.size,
			original_fcs:fcs,
			original_path:fname,
			prv_version:'0.11'
		};
		callback('',obj);
	});
}


var sumit={}
sumit.file_matches_doc=function(path,doc0) {
	var stat0=common.stat_file(path);
	if (stat0) {
		if ((stat0.size==doc0.size)&&(stat0.mtime.toISOString()==doc0.mtime)&&(stat0.ctime.toISOString()==doc0.ctime)&&(stat0.ino==doc0.ino)) {
			return true;
		}
	}
	return false;
}
sumit.find_doc_by_sha1=function(sha1,valid_prv_search_paths,callback) {
	db_utils.findDocuments('sumit',{sha1:sha1},function(err,docs) {
		if (err) {
			callback(err);
			return;
		}
		if (docs.length===0) {
			callback(null,null);
			return;
		}
		for (var i in docs) {
			var doc0=docs[i];
			if (sumit.file_matches_doc(doc0.path,doc0)) {
				for (var i in valid_prv_search_paths) {
					if (doc0.path.indexOf(valid_prv_search_paths[i])==0) {
						callback(null,doc0);
						return;
					}
				}
			}
		}
		callback(null,null);
	});
	
}
sumit.find_doc_by_path=function(path,callback) {
	db_utils.findDocuments('sumit',{path:path},function(err,docs) {
		if (err) {
			callback(err);
			return;
		}
		if (docs.length===0) {
			callback(null,null);
			return;
		}
		for (var i in docs) {
			var doc0=docs[i];
			if (sumit.file_matches_doc(doc0.path,doc0)) {
				callback(null,doc0);
				return;
			}
		}
		callback(null,null);
	});
}
sumit.compute_file_sha1=function(path,callback) {
	var stat0=common.stat_file(path);
	if (!stat0) {
		callback('Unable to stat file.','');
		return;
	}
	sumit.find_doc_by_path(path,function(err,doc0) {
		if (err) {
			callback(err);
			return;
		}
		if (doc0) {
			callback(null,doc0.sha1);
			return;
		}
		var stream = require('fs').createReadStream(path);
		sha1(stream,function(err,hash) {
			if (err) {
				callback('Error: '+err);
				return;
			}
			var doc0={
				path:path,
				sha1:hash,
				size:stat0.size,
				ctime:stat0.ctime.toISOString(),
				mtime:stat0.mtime.toISOString(),
				ino:stat0.ino
			};
			db_utils.saveDocument('sumit',doc0,function(err) {
				if (err) {
					callback(err);
					return;
				}
				callback('',doc0.sha1);
			});
		});
	});
	
}
function compute_file_sha1(path,callback) {
	sumit.compute_file_sha1(path,callback);
}

function compute_sha1_of_head(fname,num_bytes) {
	var buf=read_part_of_file(fname,0,num_bytes);
	if (!buf) return null;
	return sha1(buf);
}

function file_matches_fcs_section(path,fcs_section) {
	var tmp=fcs_section.split('-');
	if (tmp.length!=2) {
		console.warn('Invalid fcs section: '+fcs_section);
		return false;
	}
	if (tmp[0]=='head1000') {
		var fcs0=compute_sha1_of_head(path,1000);
		if (!fcs0) return false;
		return (fcs0==tmp[1]);
	}
	else {
		console.warn('Unexpected head section: '+fcs_section);
		return false;
	}
}

function get_prv_search_paths() {
	var ret=[];
	ret.push(process.cwd());
	ret.push(process.env.HOME+'/.mountainlab/tmp');
	return ret;
}

function read_part_of_file(path, start, num_bytes) {
	var stat0=common.stat_file(path);
	if (!stat0) return null;
	if (stat0.size<start+num_bytes)
		num_bytes=stat0.size-start;
	if (num_bytes<0) return null;
	if (num_bytes==0) return new Buffer(0);
	var buf=new Buffer(num_bytes);
	var fd=require('fs').openSync(path,'r');
	require('fs').readSync(fd,buf,0,num_bytes,start);
	require('fs').closeSync(fd);
	return buf;
}

function file_matches_fcs(path,fcs) {
	var list=fcs.split(';');
	for (var i in list) {
		if (list[i]) {
			if (!file_matches_fcs_section(path,list[i]))
				return false;
		}
	}
	return true;
}

function prv_locate_in_path(path,sha1,fcs,size,callback) {
	var files=common.read_dir_safe(path);
	common.foreach_async(files,function(ii,file,cb) {
		var fname=path+'/'+file;
		var stat0=common.stat_file(fname);
		if (stat0) {
			if (stat0.isFile()) {
				if (stat0.size==size) { //candidate
					sumit.find_doc_by_path(fname,function(err,doc0) {
						if (err) {
							callback(err);
							return;
						}
						if (doc0) {
							if (doc0.sha1==sha1) {
								callback('',fname)
								return;
							}
							else {
								cb();
							}
						}
						else {
							if (file_matches_fcs(fname,fcs)) {
								sumit.compute_file_sha1(fname,function(err,sha1_of_fname) {
									if (sha1_of_fname==sha1) {
										callback('',fname);
										return;
									}
									else {
										cb();
									}
								});
							}
							else {
								cb();
							}
						}
					});
				}
				else {
					cb();
				}
			}
			else if (stat0.isDirectory()) {
				prv_locate_in_path(fname,sha1,fcs,size,function(err,fname0) {
					if (fname0) {
						callback('',fname0);
						return;
					}
					cb();
				});
			}
			else {
				cb();
			}
		}
	},function() {
		callback('',''); //not found
	});
}