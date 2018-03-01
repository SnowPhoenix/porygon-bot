'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const irc = require('irc');
const Discord = require('discord.js');
const mysql = require('promise-mysql');
const config = require('./config');
const db = require('./services/db');
const commands = require('./commands');
const tasks = require('./tasks');
const warn = _.memoize(console.warn);
const ircBots = [];
let discordBot = null;

class ircConnection {

    outputResponse(bot, target, messages) {
        if (!messages) {
            return;
        }
        if (typeof messages === 'string') {
            bot.ircBot.say(target, messages);
        } else if (Array.isArray(messages)) {
            for (let i = 0; i < messages.length; i++) {
                bot.outputResponse(bot, target, messages[i]);
            }
        } else if (_.isObject(messages) && typeof messages.then === 'function') {
            messages.then(function (results) {
                bot.outputResponse(bot, target, results);
            }, function (error) {
                bot.handleError(bot, target, error);
            });
        } else if (typeof messages === 'object' && ('response_type' in messages)) {
            if ('target' in messages) {
                target = messages['target'];
            }
            switch (messages['response_type']) {
                case 'text':
                    bot.ircBot.say(target, messages['message']);
                    break;
                case 'action':
                    bot.ircBot.action(target, messages['message']);
                    break;
                default:
                    console.log("Message containing invalid `response_type` passed to outputResponse()");
            }
        } else {
            throw 'Invalid `messages` argument passed to outputResponse()';
        }
    }

    defaultAllow ({isPM, isMod, isAuthenticated}) { // The default allow() function that gets used for a command if allow() is not provided
        return !isPM || isMod && isAuthenticated;
    }

    // Main listener for channel messages/PMs
    executeCommands (bot, event, author, channel, text) {
        let isPM = channel === bot.ircBot.nick;
        let target = isPM ? author : channel;
        for (let i in commands[event]) {
            let message_match = (commands[event][i].message_regex || /.*/).exec(text);
            let author_match = (commands[event][i].author_regex || /.*/).exec(author);
            if (message_match && author_match && author !== bot.ircBot.nick && (isPM || bot.checkEnabled(channel, i, bot.settings.channels[channel].commands))) {
                Promise.join(bot.checkIfUserIsMod(author), bot.checkAuthenticated(bot, author), (isMod, isAuthenticated) => {
                    if ((commands[event][i].allow || bot.defaultAllow)({isPM, isMod, isAuthenticated})) {
                        bot.outputResponse(bot, target, commands[event][i].response({bot: bot.ircBot, message_match, author_match, author, channel, isMod, isAuthenticated, eventType: event, isPM}));
                    }
                }).catch(_.partial(bot.handleError, bot, target));
            }
        }
    }

    handleError (bot, target, error) {
        if (error.error_message) {
            bot.outputResponse(bot, target, error.error_message);
        }
        if (_.isError(error)) {
            console.error(error);
        }
    }

    checkIfUserIsMod (username) { // Returns a Promise that will resolve as true if the user is in the mod database, and false otherwise
        if (config.disable_db || db.conn == null) {
            return Promise.resolve(true);
        }
        return db.conn.query('SELECT * FROM User U JOIN Alias A ON U.UserID = A.UserID WHERE A.Alias = ? AND A.isNick = TRUE', [username]).then(res => !!res.length);
    }

    checkAuthenticated (bot, username) { // Returns a Promise that will resolve as true if the user is identified, and false otherwise
        bot.ircBot.say('NickServ', `STATUS ${username}`);
        var awaitResponse = () => new Promise(resolve => {
            bot.ircBot.once('notice', (nick, to, text) => {
                if (nick === 'NickServ' && to === bot.ircBot.nick && text.indexOf(`STATUS ${username} `) === 0) {
                    resolve(text.slice(-1) === '3');
                } else { // The notice was something unrelated, set up the listener again
                    resolve(awaitResponse());
                }
            });
        });
        return awaitResponse().timeout(5000, 'Timed out waiting for NickServ response');
    }

    checkEnabled (channelName, itemName, itemConfig) {
        if (itemConfig === undefined) {
            warn(`Warning: No channel-specific configuration found for the channel ${channelName}. All commands on this channel will be ignored.`);
            return false;
        }
        if (_.isBoolean(itemConfig)) {
            return itemConfig;
        }
        if (_.isRegExp(itemConfig)) {
            return itemConfig.test(itemName);
        }
        if (_.isArray(itemConfig)) {
            return _.includes(itemConfig, itemName);
        }
        if (_.isString(itemConfig)) {
            return itemConfig === itemName;
        }
        if (_.isFunction(itemConfig)) {
            return !!itemConfig(itemName);
        }
        warn(`Warning: Failed to parse channel-specific configuration for the channel ${channelName}. All commands on this channel will be ignored.`);
        return false;
    }

    executeTask(bot, taskName) {
        const params = tasks[taskName];
        const iteratee = params.concurrent ? params.task : _.once(params.task);
        _.forOwn(bot.settings.tasks, (channelConfig, channel) => {
            if (bot.checkEnabled(channel, taskName, channelConfig)) {
                bot.outputResponse(bot, channel, iteratee({bot: bot.ircBot, channel: params.concurrent ? channel : null}));
            }
        });
    }

    constructor(settings) {
        this.settings = settings;
        this.ircBot = new irc.Client(settings.server, settings.nick, {
            userName: settings.userName,
            realName: settings.realName,
            channels: _.isArray(settings.channels) ? settings.channels : _.keys(settings.channels),
            port: settings.port,
            secure: settings.secure,
            selfSigned: settings.selfSigned,
            certExpired: settings.certExpired,
            encoding: 'UTF-8',
            password: settings.password
        });

        this.ircBot.on('error', console.error);
        this.ircBot.on('message', _.partial(this.executeCommands, this, 'message'));
        this.ircBot.on('join', (chan, user) => this.executeCommands(this, 'join', user, chan));
        this.ircBot.on('action', _.partial(this.executeCommands, this, 'action'));
        this.ircBot.on('+mode', (chan, by, mode, argument) => this.executeCommands(this, `mode +${mode}`, by, chan, argument));
        this.ircBot.on('-mode', (chan, by, mode, argument) => this.executeCommands(this, `mode -${mode}`, by, chan, argument));

        this.ircBot.once('join', () => {
            _.forOwn(tasks, (params, taskName) => {
                if (params.onStart) {
                    this.executeTask(this, taskName);
                }
                setInterval(this.executeTask, params.period * 1000, this, taskName);
            });
        });
    }
}

class discordConnection {

    generateResponse(bot, target, messages) {
        if (!messages) {
            return;
        }
        if (typeof messages === 'string') {
            return messages;
        } else if (Array.isArray(messages)) {
            return _.map(messages, _.partial(bot.generateResponse, bot, target)).join('\n');
        } else if (_.isObject(messages) && typeof messages.then === 'function') {
            messages.then(function (results) {
                bot.outputResponse(bot, target, results);
            }, function (error) {
                bot.handleError(bot, target, error);
            });
        } else if (typeof messages === 'object' && ('response_type' in messages)) {
            if ('target' in messages) {
                target = messages['target'];
            }
            switch (messages['response_type']) {
                case 'text':
                    return messages['message'];
                case 'action':
                    return '_'+messages['message']+'_';
                default:
                    console.log("Message containing invalid `response_type` passed to outputResponse()");
            }
        } else {
            throw 'Invalid `messages` argument passed to outputResponse()';
        }
    }

    outputResponse(bot, target, messages) {
        let output = bot.generateResponse(bot, target, messages);
        if (output) {
          console.log("Sending output messages");
            target.send(messages);
        }
    }

    defaultAllow ({isPM, isMod, isAuthenticated}) { // The default allow() function that gets used for a command if allow() is not provided
        return !isPM || isMod && isAuthenticated;
    }

    handleError (bot, target, error) {
        if (error.error_message) {
            bot.outputResponse(bot, target, error.error_message);
        }
        if (_.isError(error)) {
            console.error(error);
        }
    }

    checkIfUserIsMod (id) { // Returns a Promise that will resolve as true if the user is in the mod database, and false otherwise
        if (config.disable_db || db.conn == null) {
            return Promise.resolve(true);
        }
        return db.conn.query('SELECT * FROM discord_id WHERE DiscordID = ?', [id]).then(res => !!res.length);
    }

    checkEnabled (channelName, itemName, itemConfig) {
        if (itemConfig === undefined) {
            warn(`Warning: No channel-specific configuration found for the channel ${channelName}. All commands on this channel will be ignored.`);
            return false;
        }
        if (_.isBoolean(itemConfig)) {
            return itemConfig;
        }
        if (_.isRegExp(itemConfig)) {
            return itemConfig.test(itemName);
        }
        if (_.isArray(itemConfig)) {
            return _.includes(itemConfig, itemName);
        }
        if (_.isString(itemConfig)) {
            return itemConfig === itemName;
        }
        if (_.isFunction(itemConfig)) {
            return !!itemConfig(itemName);
        }
        warn(`Warning: Failed to parse channel-specific configuration for the channel ${channelName}. All commands on this channel will be ignored.`);
        return false;
    }

    // Main listener for channel messages/PMs
    executeCommands (bot, event, author, channel, message) {
        let isPM = channel.type === 'dm' ? true : false;
        let target = channel;
        let text = message.content;
        if (event === 'action') {
            text = message.content.slice(1,-1);
        }
        for (let i in commands[event]) {
            let message_match = (commands[event][i].message_regex || /.*/).exec(text);
            let author_match = (commands[event][i].author_regex || /.*/).exec(author.id);
            if (message_match && author_match && author.id !== bot.client.user.id && (isPM || bot.checkEnabled(channel.id, i, bot.settings.channels[channel.id]))) {
                bot.checkIfUserIsMod(author.id).then(isMod => {
                    if ((commands[event][i].allow || bot.defaultAllow)({isPM, isMod, isAuthenticated: true})) {
                        bot.outputResponse(bot, target, commands[event][i].response({bot: bot.client, message_match, author_match, channel: channel.id, isMod, isAuthenticated: true, eventType: event, isPM}));
                    }
                }).catch(_.partial(bot.handleError, bot, target));
            }
        }
    }

    constructor(settings) {
        this.client = new Discord.Client();
        this.settings = settings;

        this.client.on('ready', () => {
          console.log('I am ready!');
        });

        /*client.on('presenceUpdate', (oldStatus, newStatus) => {
            if (oldStatus.presence.status !== 'online' && newStatus.presence === 'online') {
                this.executeCommands(this, 'join', newStatus.user); // Events are not channel specific here.
            }
            console.log("LOGGING OLD STATUS");
            console.log(oldStatus.presence);
            console.log("LOGGING NEW STATUS");
            console.log(newStatus.presence);
        });*/

        this.client.on('message', message => {
            this.executeCommands(this, 'message', message.author, message.channel, message);
            if (message.content.charAt(0) === '_' && message.content.charAt(message.content.length-1) === '_') {
                this.executeCommands(this, 'action', message.author, message.channel, message);
            }
        });

        this.client.login(settings.discordToken);
    }
}

if (!config.disable_db) {
    mysql.createConnection({
        host: config.dbHost,
        user: config.dbUser,
        port: config.dbPort,
        password: config.dbPassword,
        database: config.database,
        timezone: 'Etc/UTC'
    }).then(function(conn) {

        db.conn = conn;

        Object.keys(db.modules).forEach(function(event) {
            Object.keys(db.modules[event]).forEach(function(name) {
                if (commands[event] === undefined) {
                    commands[event] = {};
                }
                commands[event][name] = db.modules[event][name];
            });
        });

    }).catch(function(error) {
        console.log("An error occurred while establishing a connection to the database. Details can be found below:\n"+error+"\nThe following modules, which require database connectivity, have been disabled: ["+db.listModules().join(", ")+"]");
    });
} else {
    console.log("The following modules, which require database connectivity, have been disabled: ["+db.listModules().join(", ")+"]");
}

if (config.ircConfig) {
    for (let i = 0; i < config.ircConfig.length; i++) {
        console.log(config.ircConfig[i]);
        ircBots.push(new ircConnection(config.ircConfig[i]));
    }
}

if (config.discordConfig) {
    discordBot = new discordConnection(config.discordConfig);
}