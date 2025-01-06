import TwitchJs, { Chat, ChatCommands, ChatEvents, PrivateMessageEvents } from "twitch-js";

// Provide your username and token secret keys from Server Control Panel (left).
// To generate tokens, use https://twitchtokengenerator.com.
const username = process.env.USERNAME;
const token = process.env.TOKEN;
const channel = "himiechan";

const chat = new Chat({
    // username,
    // token
});

const approvedUsers: string[] = new Array(
    "himiechan",
    "streamlootsbot"
);

export async function addVip(memberName: string) {
    console.log("Adding VIP %s", memberName)
    chat.vip(channel, memberName)
}

const run = async () => {

  await chat.connect();
  await chat.join(channel);

  chat.on("PRIVMSG", (message) => {
    const chatMessage = message.message;
    const params = chatMessage.split(" ");
    const command = params.at(0);
    const chatUser = message.username;
    console.log("%s : %s", chatUser, chatMessage);

    if (!approvedUsers.includes(chatUser)){
        console.log("User has no permissions");
        return;
    }
    switch (command) {
        case "!vip": {
            addVip(params[1])
            break;
        }
        default: {
            console.log("Unknown command %s", command)
            break;
        }
    }
  });
};

run();