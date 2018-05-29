'use strict';

const	shuffleArray	= require('shuffle-array'),
	startupTime	= new Date(),
	database	= {'newPosts': []},
	request	= require('request'),
	tumblr	= require('tumblr.js'),
	moment	= require('moment'),
	async	= require('async'),
	auth	= require(__dirname + '/auth.json'),
	url	= require('url'),
	fs	= require('fs');

let	ignoredDuplicates	= 0;

require('console-warn');
require('console-info');

console.info('Starting up');

function checkBlog(options, cb) {
	const	reqOptions	= {};

	if (typeof options === 'string') {
		options	= {'blogUrl': options};
	}

	if ( ! options.offset) {
		console.info('Checking blog: "' + options.blogUrl + '"');
		options.offset	= 0;
	}

	reqOptions.json	= true;

	reqOptions.url	= 'https://api.tumblr.com/v2/blog/' + options.blogUrl + '/posts';
	reqOptions.url	+= '?api_key=' + auth.api_key;
	reqOptions.url	+= '&limit=20&offset=' + options.offset;
	reqOptions.url	+= '&filter=raw&reblog_info=true';

	request(reqOptions, function (err, response, body) {
		if (err) throw err;

		if (response.statusCode !== 200) {
			console.warn('Non-200 statusCode: ' + response.statusCode + ' for URL "' + reqOptions.url + '"');
			return cb();
		}

		if ( ! body.response || ! body.response.posts) {
			console.warn('Invalid response body:');
			console.log(body);
			return cb();
		}

		if (body.response.posts.length === 0) {
			process.stdout.write('\n');
			console.info('No more posts - we are done');
			writeDatabaseNewPosts();
			writeDatabaseIndexedPosts();
			return cb();
		}

		for (let i = 0; body.response.posts[i] !== undefined; i ++) {
			const	post	= body.response.posts[i];

			let	uniqueId;

			if (post.url) {
				uniqueId	= post.url;
			} else if (post.source_url) {
				uniqueId	= post.source_url;
			} else {
				uniqueId	= post.post_url;
			}

			// If post date is older than last post in database, return cb()
			if (new Date(post.date) < new Date(database.metadata.lastChecked)) {
				process.stdout.write('\n');
				console.info('Last post checked dated: ' + moment(new Date(post.date)).format('YYYY-MM-DD HH:mm:ss') + ' - we are done here.');
				writeDatabaseNewPosts();
				writeDatabaseIndexedPosts();
				return cb();
			}

			// Check if this post is in the database
			if ( ! database.indexedPosts[uniqueId]) {
				const	newPost	= {};

				if (post.source_url) {
					newPost.post_url	= post.source_url;
				} else {
					newPost.post_url	= post.post_url;
				}

				newPost.type	= post.type;

				if (newPost.type === 'photo') {
					newPost.img	= post.photos[0].original_size.url;
				} else if (newPost.type === 'link') {
					newPost.link	= post.url;
				} else if (newPost.type === 'video') {
					let	largest	= 0;
					for (let i = 0; post.player[i] !== undefined; i ++) {
						if (post.player[i].width > post.player[largest]) {
							largest	= i;
						}
					}
					newPost.video	= post.player[largest].embed_code;
				}

				database.indexedPosts[uniqueId]	= newPost;
				database.newPosts.push(database.indexedPosts[uniqueId]);
			} else {
				ignoredDuplicates ++;
			}
		}

		// If we get down here, we should try again with higher offset
		options.offset	+= 20;
		process.stdout.write('...' + moment(new Date(body.response.posts[0].date)).format('YYYY-MM-DD HH:mm:ss'));
		checkBlog(options, cb);
	});
}

function checkBlogs(cb) {
	const	tasks	= [];

	console.info('Checking blogs');

	database.metadata.watchedBlogs	= shuffleArray(database.metadata.watchedBlogs);

	for (let i = 0; database.metadata.watchedBlogs[i] !== undefined; i ++) {
		const	blogUrl	= database.metadata.watchedBlogs[i];
		tasks.push(function (cb) {
			checkBlog(blogUrl, cb);
		});
	}

	tasks.push(writeDatabase);

	async.series(tasks, cb);
}

function getWatchedBlogs(cb) {
	const client = tumblr.createClient({
		'consumer_key':	auth.consumer_key,
		'consumer_secret':	auth.consumer_secret,
		'token':	auth.token,
		'token_secret':	auth.token_secret
	});

	console.info('Getting watched blogs');

	function getFollowed(offset, cb) {
		client.userFollowing({'offset': offset}, function (err, result) {
			if (err) throw err;

			if (result.blogs.length === 0) {
				writeDatabaseMetadata();
				return cb();
			}

			for (let i = 0; result.blogs[i] !== undefined; i ++) {
				const	blog	= result.blogs[i],
					domain	= url.parse(blog.url).hostname;

				if (database.metadata.watchedBlogs.indexOf(domain) === - 1) {
					console.info('Added watched blog: ' + domain);
					database.metadata.watchedBlogs.push(domain);
				}
			}

			getFollowed(offset + 20, cb);
		});
	}

	getFollowed(0, cb);
};

function writeDatabase() {
	console.info('Writing database');
	database.metadata.lastChecked	= startupTime;
	writeDatabaseMetadata();
	writeDatabaseNewPosts();
	writeDatabaseIndexedPosts();
	console.info('Database written');
}

function writeDatabaseMetadata() {
	console.info('Writing metadata database');
	fs.writeFileSync(__dirname + '/database/metadata.json', JSON.stringify(database.metadata));
	console.info('Metadata database written');
}

function writeDatabaseNewPosts() {
	console.info('Writing new posts database');
	fs.writeFileSync(__dirname + '/database/newPosts.json', JSON.stringify(database.newPosts));
	console.info('New posts database written');
}

function writeDatabaseIndexedPosts() {
	console.info('Writing indexed posts database');
	fs.writeFileSync(__dirname + '/database/posts.json', JSON.stringify(database.indexedPosts));
	console.info('Indexed posts database written');
}

if ( ! fs.existsSync(__dirname + '/database/metadata.json')) {
	database.metadata = {
		'lastChecked':	undefined,
		'watchedBlogs':	[]
	};
} else {
	database.metadata	= require(__dirname + '/database/metadata.json');
}

if ( ! fs.existsSync(__dirname + '/database/posts.json')) {
	database = {
		'indexedPosts': {}
	};
} else {
	database.indexedPosts	= require(__dirname + '/database/posts.json');
}

if ( ! database.metadata.lastChecked) {
	database.metadata.lastChecked	= moment().subtract(1, 'month');
}

getWatchedBlogs(function (err) {
	if (err) throw err;
	checkBlogs(function (err) {
		if (err) throw err;
		console.info('Blogs checked, database updated, all done. Found ' + database.newPosts.length + ' new posts and ignoring ' + ignoredDuplicates + ' posts');
	});
});
