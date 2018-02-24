'use strict';

const	ejs	= require('ejs'),
	App	= require('larvitbase'),
	log	= require('winston'),
	url	= require('url'),
	fs	= require('fs'),
	qs	= require('querystring');

log.remove(log.transports.Console);
/**/log.add(log.transports.Console, {
	'level':	'debug',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/**/

new App({
	'httpOptions': 8001, // Listening port
	'middleware': [
		function (req, res) {
			const	template	= fs.readFileSync(__dirname + '/www.ejs').toString(),
				pageData	= {},
				newPosts	= JSON.parse(fs.readFileSync(__dirname + '/database/newPosts.json').toString()),
				page	= qs.parse(url.parse(req.url).query).page || 1;

			pageData.posts	= newPosts.slice((page - 1) * 100, page * 100);
			pageData.page	= page;

			res.end(ejs.render(template, pageData));
		}
	]
});
