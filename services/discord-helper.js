const discordRegex = new RegExp(/^\d+$/);

module.exports = {
    printUsername(userString) {
        console.log("In print username: "+typeof userString);
        return module.exports.isDiscordId(userString) ? `<@${userString}>` : userString;
    },

    printChannel(channelString) {
        return module.exports.isDiscordId(channelString) ? `<#${channelString}>` : channelString;
    },

    isDiscordId(str) {
        console.log("In isDiscordId: "+typeof str);
        console.log(str);
        if (str.match(discordRegex)) {
            return true;
        }
        return false;
    }
};