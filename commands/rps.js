'use strict';
const dh = require('../services/discord-helper');

module.exports = {
    message_regex: /\.rps (rock|paper|scissors)/i,
    response ({message_match: [, formattedPlayerTurn], author_match: [author_match], bot}) {
        console.log("typeof author_match = "+typeof author_match);
        const playerName = dh.printUsername(author_match);
        const myName = dh.isDiscordId(author_match) ? `<@${bot.user.id}>` : bot.nick;
        const myTurn = randomTurn();
        const playerTurn = parse(formattedPlayerTurn);
        return `${playerName} plays ${formattedPlayerTurn}. ${myName} plays ${format(myTurn)}. ${getLastSentence(myTurn, playerTurn, myName, playerName)}.`;
    }
};

function parse (playerTurn) {
    return {rock: 0, paper: 1, scissors: 2}[playerTurn.toLowerCase()];
}

function format (turnNum) {
    return ['rock', 'paper', 'scissors'][turnNum];
}

function randomTurn () {
    const randomByte = require('crypto').randomBytes(1).readUInt8(0);
    // if the random byte is 255, roll again. This ensures that the number of possible values of the random byte is divisible
    // by 3, so all outcomes are equally likely.
    return randomByte === 255 ? randomTurn() : randomByte % 3;
}

function getLastSentence (myTurn, playerTurn, myName, playerName) {
    return myTurn === playerTurn ? 'Tie' : (myTurn + 1) % 3 === playerTurn ? `${playerName} wins` : `${myName} wins`;
}
