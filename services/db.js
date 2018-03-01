const dh = require('./discord-helper');

exports.conn = null;
exports.modules = {};
exports.getUserInfo = function(user) {
    let query = dh.isDiscordId(user) ? 'SELECT * FROM discord_id D JOIN User U ON D.UserID = U.UserID WHERE DiscordID = ?' : 'SELECT * FROM User U JOIN Alias A ON U.UserID = A.UserID WHERE A.Alias = ?';
    return exports.conn.query(query, [user]).then(function(result) {
        return result;
    }).catch(function(err) {
        console.log(err);
    });
};
exports.listModules = function() {
    var module_list_keys = {};
    var type_list = Object.keys(exports.modules);
    for (var current_type = 0; current_type < type_list.length; current_type++) {
        var modules = Object.keys(exports.modules[type_list[current_type]]);
        for (var current_module = 0; current_module < modules.length; current_module++) {
            module_list_keys[modules[current_module]] = true;
        }
    }
    return Object.keys(module_list_keys);
};
