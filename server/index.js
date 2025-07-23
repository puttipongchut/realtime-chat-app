const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
// const { availableParallelism } = require("node:os");
// const cluster = require("node:cluster");
// const { createAdapter, setupPrimary } = require("@socket.io/cluster-adapter");

// if (cluster.isPrimary) {
//   const numCPUs = availableParallelism();

//   for (let i = 0; i < numCPUs; i++) {
//     cluster.fork({
//       PORT: 5000 + i,
//     });
//   }

//   return setupPrimary();
// }

async function main() {
  const db = await open({
    filename: "chat.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_offset TEXT UNIQUE,
          content TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          nickname TEXT
      );
    `);

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {},
    // adapter: createAdapter(),
  });

  app.get("/", (req, res) => {
    res.sendFile(join(__dirname, "index.html"));
  });

  // io.on('connection', (socket) => {
  //     console.log('a user connected!');
  //     socket.on('disconnect', () => {
  //         console.log('user disconnected');
  //     })
  // })

  // io.on('connection', (socket) => {
  //     socket.on('chat message', (msg) => {
  //         console.log('message: ' + msg);
  //     });
  // });

  io.on("connection", async (socket) => {

    socket.on('join', async (nickname) => {
      socket.userId = uuidv4();
      socket.nickname = nickname;
      try {
        await db.run(
          "INSERT INTO users (id, nickname) VALUES (?, ?)", [socket.userId, nickname]
        );
      } catch (error) {
        console.log(error);
      }
      io.emit("user connected", nickname);
    });

    socket.on('disconnect', async () => {
      const userId = socket.userId;
      const name = socket.nickname || 'Unknown User';
      try {
        await db.run("DELETE FROM users WHERE id = ?", userId);
      } catch (error) {
        console.log(error);
      }
      io.emit("user disconnected", name);
    });

    socket.on("chat message", async (msg, clientOffset, userId, callback) => {
      let result, user;
      try {
        result = await db.run(
          "INSERT INTO messages (content, client_offset) VALUES (?, ?)",
          msg,
          clientOffset
        );
        user = await db.get(
          "SELECT FROM users WHERE nickname = ?", userId
        );
        console.log('extracted user');
      } catch (error) {
        if (error.errno === 19) {
          callback();
        } else {
          // let the client retry
        }
        return;
      }
      io.emit("chat message", msg, result.lastID, user);
      callback();
    });

    if (!socket.recovered) {
      try {
        await db.each(
          "SELECT id, content FROM messages WHERE id > ?",
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            socket.emit("chat message", row.content, row.id);
          }
        );
      } catch (error) {
        console.log(error);
      }
    }
  });

//   const port = process.env.PORT;
const port = 5000;

  server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

main();
