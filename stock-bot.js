"use strict"

// Node.js does not natively support XMLHttpRequests, so a package (more specifically, the constructor Object) is required
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
// Get the Discord API
const Discord = require("discord.js");
// Get the bot's config file and the data inside
const config = require("./config.json");
// The prefix is the command that triggers the bot, the token validates the bot to the server, and the key is for AlphaVantage API
// The token and the key are stored on a separate file for privacy
const {prefix, token, key} = config;
// Create a new client, which detects and executes all commands and / or events directed to the bot
const client = new Discord.Client();

// Define the commands the bot can take
const commands = {
    // Command to request daily data
    d: {
        // Create query based on the command and the stock code chosen
        getQuery: stock => `function=TIME_SERIES_DAILY&symbol=${stock}&outputsize=full&apikey=${key}`,
        // The time series is the key in the JSON file under which the stock data is stored (will be of use later)
        timeSeries: "Time Series (Daily)",
    },

    // Command to request minutely data on the current day
    t: {
        getQuery: stock => `function=TIME_SERIES_INTRADAY&symbol=${stock}&interval=1min&outputsize=full&apikey=${key}`,
        timeSeries: "Time Series (1min)",
    },

    // Command to request monthly data
    m: {
        getQuery: stock => `function=TIME_SERIES_MONTHLY&symbol=${stock}&apikey=${key}`,
        timeSeries: "Monthly Time Series",
    },
}

// When the client is ready, trigger this one-time code
client.once("ready", () => {
    // Sets the bot's Discord status to "Playing with stocks" (the playing part is by default already there)
    client.user.setActivity("with stocks");
});

// Log the bot into the server
client.login(token);

// Every time a message is sent in the server, trigger this code
client.on("message", message => {
    // If the message doesn't start with the wanted prefix, ignore it
    // message.author.bot returns a boolean stating whether the one who sent the message is a bot
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    // Take the user input and break it into an array by space-separated chunks
    // The chunks can be separated by more than 1 space, just in case
    // The command should come in with the form: [prefix][stock-chosen] [command-chosen] [date-time-chosen]
    const args = message.content.split(/ +/);

    // Remove the first item (the stock-chosen), detach the prefix from it, and store it in its own variable
    const stock = args.shift().replace(prefix, "").toUpperCase();
    // If the user actually sent a help command, and wasn't actually requesting a stock
    if (stock === "HELP") {
        return message.channel.send(`To use the stock bot, all requests must be sent in the form:\n*[prefix][stock-chosen] [command-chosen] [date-time-chosen]*\n\nThe current prefix is ${prefix}\nAfter the prefix comes the stock code: for example, Microsoft would be MSFT, and Tesla would be TSLA. Capitals not necessary.\nThen comes the command. Here, you have 3 choices: t for time, d for day, and m for month.\n\nThe last part, the date-time-chosen, depends on the command.\nIf you chose the time command, then enter a time in hh:mm format, and the stock value at that time on the most recent day will be returned.\nIf you chose the date command, enter a date in yyyy-mm-dd format.\nIf you chose the month command, enter a month in the yyyy-mm format.\n**Shortcut: Entering a time value as "now" will return the latest minute / day / month data.**\n\nFor any command, the data returned is as follows:\n**Open:** The stock value at the start of the minute / day / month\n**Close:** The stock value at the end of the minute / day / month\n**Difference:** The change from start to close\n**High / Low**: The peak and valley of the mintue / day / month\n**Range:** The distance from the high to the low\n**Volume:** The amount of stocks traded during the minute / day / month\n**Change:** The change, in USD and %, of the stock price from the previous close\n\nNote that this bot cannot retrive after-hours data. If the requested date or time is unavailable, it is because the market was closed. Remember that the market closes on weekends.\nIt could also be that the requested data is too far back. Anything over 20 years back is not stored.`);
    }

    // If there are under 2 arguments left, and it the user was not requesting help, that means 1 or more commands are missing
    // There should be 3 arguments to begin with, but .shift() has already removed 1
    if (args.length < 2) return message.channel.send("Missing command(s).");
    // Remove the command and store it
    const command = args.shift().toLowerCase();
    if (!commands[command]) return message.channel.send("Invalid command. See @stock help for details.")
    // Remove the date-time-chosen - the args array should now be empty
    const timeVal = args.shift();

    // Get stock data via server request
    const getStockData = new XMLHttpRequest();
    // The query for the request is gotten from the commands object, the key based on the user command
    getStockData.open("GET", `https://www.alphavantage.co/query?${commands[command].getQuery(stock)}`);
    // Query is sent
    getStockData.send();

    // Wait for the response to come back
    getStockData.onload = () => {
        // Parse response into JSON file, and retrieves the key-property pair that contains all the data
        // The key is based on the command chosen, and is stored as a property of the command (t, d, or m)
        const stockData = JSON.parse(getStockData.responseText)[commands[command].timeSeries];

        // If the JSON file retrieved is valid (not null or undefined), then carry on
        if (stockData) {
            /* Based on the timeVal the user has chosen, either in yyyy-mm-dd or hh:mm format, stockData is parsed.
               First, all the keys are taken out of the JSON object and placed into the array.
               Then, the find function will return the first item to matchthe condition.
               If the timeVal was "now", then the first value is returned, as it would be the most recent stock data.
               Else, the keys, as strings, are tested to see if they contain the timeVal chosen as a substring.
               If nothing is found, the find function returns a false value.
             */

            const possibleTimeVals = Object.keys(stockData);
            // The hh:mm format may get confused with mm:ss. However, since ss is always 00, we can preempitvely remove :00
            const chosenStockIndex = possibleTimeVals.find(key => timeVal === "now" || key.replace(":00", "").includes(timeVal));
            // The next key in the JSON file is the previous time value, which will be useful in calculating change
            const prevStockIndex = possibleTimeVals[possibleTimeVals.indexOf(chosenStockIndex) + 1];

            // If there was a key containing as a substring the chosen timeVal, carry on
            if (chosenStockIndex) {
                // The stockData is now narrowed down to only the properties the specific timeVal key chosen
                const chosenStockData = stockData[chosenStockIndex];
                // Destructure the chosenStockData into smaller variables
                const {"1. open": open, "2. high": high, "3. low": low, "4. close": close, "5. volume": volume} = chosenStockData;
                // Small function that adds a positive sign to positive numbers (ex: 4 => +4)
                const posSign = x => (x > 0 ? "+" : "") + x;

                // Create a fancy embed to send the data in (see Discord API documentation RichEmbed)
                // https://discord.js.org/#/docs/main/stable/class/RichEmbed
                const stockDataEmbed = new Discord.RichEmbed()
                    .setTitle(`**${stock}** Stock Data`)
                    .setDescription(`*From ${commands[command].timeSeries}, at ${chosenStockIndex}*`)
                    .addField("Open", `${open} USD`, true)
                    .addField("Close", `${close} USD`, true)
                    .addField("Difference", `${posSign((close - open).toFixed(4))} USD`, true)
                    .addField("High", `${high} USD`, true)
                    .addField("Low", `${low} USD`, true)
                    .addField("Range", `${(high - low).toFixed(4)} USD`, true)
                    .addField("Volume", volume);

                // If there exists stock data before the current timeVal, then calculate change
                if (prevStockIndex) {
                    // Unpack the date into data
                    const prevStockData = stockData[prevStockIndex];
                    // Get the close value from the JSON
                    const prevStockClose = prevStockData["4. close"];
                    // Change = (current / previous) * 100% - 100%
                    const change = posSign((close / prevStockClose * 100 - 100).toFixed(4));

                    // If positive change, then green - else, red
                    stockDataEmbed.setColor(change > 0 ? "#00ae86" : "#e74c3c");
                    stockDataEmbed.addField(
                        `Change (*from ${prevStockIndex}*)`,
                        `${(close - prevStockClose).toFixed(4)} USD (${change}%)`
                    );
                } else {
                    stockDataEmbed.addField("Change", "*Unavailable*");
                }

                // Send the embed with all the data
                message.channel.send(stockDataEmbed);
            } else {
                // To be sent if the timeVal was invalid
                message.channel.send(`The date/time you requested, **${timeVal}**, is invalid.\nEither this is because it is too far into the future or the past, or you messed up.\nPlease note that the stock market opens at 09:30 EST, and closes at 16:00 EST.\nRefer to the help command (@stock help).`)
            }
        } else {
            // To be sent if the JSON file was null or undefined (meaning the chosen stock did not exist).
            // It can be certain the error was in the stock choice, as it is the only variable part of the API query
            message.channel.send(`The stock you requested, **${stock}**, does not exist.`);
        }
    }
});
