import {login, getDispatcher} from "./core/application.js";


login().then(async user => {
    console.log(`Logged in as ${user.displayName}`);
    let dispatcher =  await getDispatcher();
    dispatcher.onNewMessage(async (message) => {
        console.log(JSON.stringify(message));
    });
})

