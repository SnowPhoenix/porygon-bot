const dh = require('../services/discord-helper');
const STACKABLE = false; // :(
const storedHands = new Map();
const leftward = new RegExp(/^\\o$/i);
module.exports = {
    message_regex: /(?:^|\s)(o\/|\\o)(?:\s|$)/i,
    author_regex: /^(?!(?:Perlkia|389665181111812096)$).*$/i,
    allow: ({isPM}) => !isPM,
    response: function ({bot, message_match: [, message], author_match: [author], channel}) {
		let channelStack = channel;
		console.log(bot);
		/*if (!dh.isDiscordId(author) && bot.settings.channels[channel].discordChannel) {
			channelStack = bot.settings.channels[channel].discordChannel;
		}*/
        if (!storedHands.has(channelStack)) storedHands.set(channelStack, []);
        const channelHands = storedHands.get(channelStack);

        if (channelHands.length && channelHands[channelHands.length - 1].direction === 'left' && !message.match(leftward)) {
          let match = channelHands.pop();
          return `${dh.printUsername(author)} ${message}${match.str} ${dh.printUsername(match.author)}`;
        }
        if (channelHands.length && channelHands[channelHands.length - 1].direction === 'right' && !!message.match(leftward)) {
          let match = channelHands.pop();
          return `${dh.printUsername(match.author)} ${match.str}${message} ${dh.printUsername(author)}`;
        }
        channelHands.push({author, direction: !message.match(leftward) ? 'right' : 'left', str: message});
        if (!STACKABLE && channelHands.length > 1) {
          channelHands.shift();
        }
    }
};
