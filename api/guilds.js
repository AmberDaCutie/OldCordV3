const express = require('express');
const globalUtils = require('../helpers/globalutils');
const { logText } = require('../helpers/logger');
const roles = require('./roles');
const members = require('./members');
const bans = require('./bans');
const emojis = require('./emojis');

const { instanceMiddleware, rateLimitMiddleware, guildMiddleware, guildPermissionsMiddleware } = require('../helpers/middlewares');

const router = express.Router();

router.param('guildid', async (req, _, next, guildid) => {
    req.guild = await global.database.getGuildById(guildid);

    next();
});

router.get("/:guildid", guildMiddleware, async (req, res) => {
    return res.status(200).json(req.guild);
});

router.post("/", instanceMiddleware("NO_GUILD_CREATION"), rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        if (!req.body.name || req.body.name == "") {
            return res.status(400).json({
                name: "This field is required."
            })
        }

        if (req.body.name.length < 1 || req.body.name.length > 30) {
            return res.status(400).json({
                name: "Must be between 1 and 30 in length."
            })
        }

        const creator = req.account;

        if (!creator) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        if (!req.body.region) {
            return res.status(400).json({
                region: "A valid server region is required."
            });
        }

        let client_date = req.client_build_date;
        let selected_region = req.body.region;
        let exclusions = [];

        let month = client_date.getMonth();
        let year = client_date.getFullYear();

        if (selected_region == "2016") {
            if (month > 3 && month <= 10 && year == 2016) {
                exclusions.push(...[
                    "system_messages",
                    "custom_emoji",
                    "mention_indicators",
                    "reactions"
                ]) // 10 = september, 11 = october, 12 = november, 13 = december
            } else if (month > 9 && month <= 13 && year == 2016) {
                exclusions.push("reactions");
            } else if (year != 2016) selected_region = "everything";
        }

        const guild = await global.database.createGuild(creator.id, req.body.icon, req.body.name, req.body.region, exclusions);

        if (guild == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        } else {
            if (!req.channel_types_are_ints) {
                guild.channels[0].type = "text";
            }

            await global.dispatcher.dispatchEventTo(creator.id, "GUILD_CREATE", guild);

            return res.status(200).json(guild);
        }
      } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

//later 2016 guild deletion support - why the fuck do they do it like this?
router.post("/:guildid/delete", guildMiddleware, rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        const user = req.account;

        if (!user) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        if (guild.owner_id != user.id) {
            return res.status(403).json({
                code: 403,
                message: "Missing Permissions"
            });
        }

        await global.dispatcher.dispatchEventInGuild(guild, "GUILD_DELETE", {
            id: req.params.guildid
        });
        
        const del = await global.database.deleteGuild(guild.id);

        if (!del) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        return res.status(204).send();
    } catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.delete("/:guildid", guildMiddleware, rateLimitMiddleware(50, 1000 * 60 * 60), async (req, res) => {
    try {
        const user = req.account;

        if (!user) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        if (guild.owner_id == user.id) {
            await global.dispatcher.dispatchEventInGuild(guild, "GUILD_DELETE", {
                id: req.params.guildid
            });
            
            const del = await global.database.deleteGuild(guild.id);

            if (!del) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            return res.status(204).send();
        } else {
            const leave = await global.database.leaveGuild(user.id, guild.id);

            if (!leave) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            await global.dispatcher.dispatchEventTo(user.id, "GUILD_DELETE", {
                id: req.params.guildid
            });

            await global.dispatcher.dispatchEventInGuild(req.guild, "GUILD_MEMBER_REMOVE", {
                type: "leave",
                roles: [],
                user: globalUtils.miniUserObject(user),
                guild_id: req.params.guildid
            })

            return res.status(204).send();
        }
    } catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
            code: 500,
            message: "Internal Server Error"
        });
    }
});

router.patch("/:guildid", guildMiddleware, guildPermissionsMiddleware("MANAGE_GUILD"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let what = req.guild;

        if (what == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }

        if (req.body.name && req.body.name.length < 2 || req.body.name && req.body.name.length > 30) {
            return res.status(400).json({
                name: "Must be between 2 and 30 in length."
            })
        }

        if (req.body.region && req.body.region != what.region) {
            return res.status(400).json({
                region: "Cannot change the oldcord year region for this server at this time. Try again later."
            });
        }

        if (req.body.default_message_notifications && req.body.default_message_notifications < 0) {
            return res.status(400).json({
                code: 400,
                message: "Default Message Notifications must be less or equal than 3 but greater than 0."
            }); 
        }
        
        if (req.body.default_message_notifications && req.body.default_message_notifications > 3) {
            return res.status(400).json({
                code: 400,
                message: "Default Message Notifications must be less or equal than 3 but greater than 0."
            }); 
        }

        if (req.body.verification_level && req.body.verification_level < 0) {
            return res.status(400).json({
                code: 400,
                message: "Verification level must be less or equal than 3 but greater than 0."
            }); 
        }
        
        if (req.body.verification_level && req.body.verification_level > 3) {
            return res.status(400).json({
                code: 400,
                message: "Verification level must be less or equal than 3 but greater than 0."
            }); 
        }

        if (req.body.owner_id) {
            if (req.body.owner_id == sender.id) {
                return res.status(400).json({
                    code: 400,
                    message: "Cannot change the new owner to the current owner"
                });
            }

            let new_owner = what.members.find(x => x.id == req.body.owner_id);

            if (!new_owner) {
                return res.status(404).json({
                    code: 404,
                    message: "Unknown Member"
                });
            }

            let tryTransferOwner = await global.database.transferGuildOwnership(what.id, req.body.owner_id);
            
            if (!tryTransferOwner) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                }); 
            }

            what = await global.database.getGuildById(req.params.guildid);

            if (what == null) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                }); 
            }
    
            await global.dispatcher.dispatchEventInGuild(req.guild, "GUILD_UPDATE", what);
    
            return res.status(200).json(what);
        }

        const update = await global.database.updateGuild(req.params.guildid, req.body.afk_channel_id, req.body.afk_timeout, req.body.icon, req.body.splash, req.body.name, req.body.default_message_notifications, req.body.verification_level);

        if (!update) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        what = await global.database.getGuildById(req.params.guildid);

        if (what == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }

        await global.dispatcher.dispatchEventInGuild(req.guild, "GUILD_UPDATE", what);

        return res.status(200).json(what);
      } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.get("/:guildid/prune", async (_, res) => {
    return res.status(200).json([]);
});

router.post("/:guildid/prune", async (_, res) => {
    return res.status(204).send();
});

router.get("/:guildid/embed", guildMiddleware, async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const widget = await global.database.getGuildWidget(req.params.guildid);

        if (widget == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }
        
        return res.status(200).json(widget);
      } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:guildid/embed", guildMiddleware, guildPermissionsMiddleware("MANAGE_GUILD"), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const update = await global.database.updateGuildWidget(req.params.guildid, req.body.channel_id, req.body.enabled);

        if (!update) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        const widget = await global.database.getGuildWidget(req.params.guildid);

        if (widget == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            }); 
        }

        return res.status(200).json(widget);
      } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.get("/:guildid/invites", guildMiddleware, guildPermissionsMiddleware("MANAGE_GUILD"), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        const invites = await global.database.getGuildInvites(req.params.guildid);

        return res.status(200).json(invites);
      } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.post("/:guildid/channels", guildMiddleware, guildPermissionsMiddleware("MANAGE_CHANNELS"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }
        
        if (!req.guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });
        }

        const member = req.guild.members.find(x => x.id === sender.id);

        if (!member) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Member"
            });
        }

        let number_type = 0;

        if (typeof req.body.type === 'string') {
            number_type = req.body.type == "text" ? 0 : 1;
        } else number_type = req.body.type;

        const channel = await global.database.createChannel(req.params.guildid, req.body.name, number_type, req.guild.channels.length + 1);

        if (channel == null) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        }

        channel.type = typeof req.body.type === 'string' ? req.body.type : number_type;

        await global.dispatcher.dispatchEventInGuild(req.guild, "CHANNEL_CREATE", channel);

        return res.status(200).json(channel);
    } catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:guildid/channels", guildMiddleware, guildPermissionsMiddleware("MANAGE_CHANNELS"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        const sender = req.account;

        if (sender == null) {
            return res.status(401).json({
                code: 401,
                message: "Unauthorized"
            });
        }

        let ret = [];

        for(var shit of req.body) {
            var channel_id = shit.id;
            var position = shit.position;

            const channel = req.guild.channels.find(x => x.id === channel_id);

            if (channel == null) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            channel.position = position;

            const outcome = await global.database.updateChannel(channel_id, channel);

            if (!outcome) {
                return res.status(500).json({
                    code: 500,
                    message: "Internal Server Error"
                });
            }

            if (!req.channel_types_are_ints) {
                channel.type = channel.type == 2 ? "voice" : "text";
            }

            ret.push(channel);

            await global.dispatcher.dispatchEventToAllPerms(channel.guild_id, channel.id, "READ_MESSAGE_HISTORY", "CHANNEL_UPDATE", channel);
        }

        return res.status(200).json(ret);
    } catch(error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.use("/:guildid/roles", roles);
router.use("/:guildid/members", members);
router.use("/:guildid/bans", bans);
router.use("/:guildid/emojis", emojis);

//too little to make a route for it,

router.get("/:guildid/webhooks", guildMiddleware, guildPermissionsMiddleware("MANAGE_WEBHOOKS"), rateLimitMiddleware(100, 1000 * 60 * 60), async (req, res) => {
    try {
        let guild = req.guild;

        if (!guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });  
        }

        let webhooks = guild.webhooks;

        return res.status(200).json(webhooks);
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.get("/:guildid/regions", (_, res) => {
    return res.status(200).json(globalUtils.getRegions());
});

router.get("/:guildid/vanity-url", guildMiddleware, guildPermissionsMiddleware("ADMINISTRATOR"), async (req, res) => {
    try {
        if (!req.guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });  
        }

        return res.status(200).json({
            code: req.guild.vanity_url_code
        });
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

router.patch("/:guildid/vanity-url", guildMiddleware, guildPermissionsMiddleware("ADMINISTRATOR"), async (req, res) => {
    try {
        if (!req.guild) {
            return res.status(404).json({
                code: 404,
                message: "Unknown Guild"
            });  
        }

        let code = req.body.code;

        if (!code || code === "") {
            code = null;
        }

        let tryUpdate = await global.database.updateGuildVanity(req.guild.id, code);

        if (tryUpdate === 0) {
            return res.status(400).json({
                code: 400,
                code: "Vanity URL is taken or invalid."
            });
        } else if (tryUpdate === -1) {
            return res.status(500).json({
                code: 500,
                message: "Internal Server Error"
            });
        } else {
            req.guild.vanity_url_code = code;

            return res.status(200).json({
                code: code
            })
        }
    } catch (error) {
        logText(error, "error");
    
        return res.status(500).json({
          code: 500,
          message: "Internal Server Error"
        });
    }
});

module.exports = router;