const dh = require('../services/discord-helper');

// respond cutely to pets
module.exports = {
    message_regex: /pets ([^ ]*)\s*/,
    events: ['action'],
    response: function({author_match: [author_match], message_match, bot}) {
        if ((!dh.isDiscordId(author_match) && message_match[1].toUpperCase() === bot.nick.toUpperCase()) ||
            (dh.isDiscordId(author_match) && message_match[1] === `<@${bot.user.id}>` || message_match[1] === bot.user.username)) {
            return 'n_n';
        }
    }
};
