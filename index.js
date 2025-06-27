const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://e-commerce-b784b.web.app"],
    methods: ["GET", "POST", "PATCH"],
    credentials: true,
  },
});
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

//You have to require stripe after dotenv.config otherwise key won't be able to load
//as a result there will be value undefined
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

//middlewire
app.use(
  cors({
    origin: ["https://e-commerce-b784b.web.app"],
    credentials: true,
  })
);
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { send } = require("process");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7t9x1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const menuDB = client.db("Bristo_DB").collection("menu");
    const reviewsDB = client.db("Bristo_DB").collection("reviews");
    const cartDB = client.db("Bristo_DB").collection("carts");
    const userDB = client.db("Bristo_DB").collection("users");
    const paymentDB = client.db("Bristo_DB").collection("payments");
    const contactDB = client.db("Bristo_DB").collection("contacts");
    const bookingsDB = client.db("Bristo_DB").collection("bookings");
    const messageDB = client.db("Bristo_DB").collection("messages");

    //socket.io connection
    io.on("connection", socket => {
      console.log("A user connected:", socket.id);

      //joining room based on userEmail
      socket.on("joinRoom", ({ userId }) => {
        socket.join(userId);
        console.log(`${userId} joined their personal room`);
      });

      //Receive user message and send this to admin room
      socket.on("userMessage", async ({ userId, message }) => {
        await messageDB.insertOne({
          userId,
          sender: "user",
          message,
          timestamp: new Date(),
        });
        io.to("adminRoom").emit("userMessage", { userId, message });
      });

      //admin joins adminRoom
      socket.on("joinAdminRoom", () => {
        socket.join("adminRoom");
        console.log("Admin joined adminRoom");
      });

      //admin replies to a specific user
      socket.on("adminMessage", async ({ userId, message }) => {
        await messageDB.insertOne({
          userId,
          sender: "admin",
          message,
          timestamp: new Date(),
        });
        io.to(userId).emit("adminMessage", message);
      });

      socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
      });
    });

    //jwt related api
    app.post("/jwt", async (req, res) => {
      //const user = req.body;
      const user = { email: req.body.email };
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      const authHeader = req.headers.authorization;
      // console.log("Inside verify token ", req.headers);
      if (!authHeader) {
        return res.status(401).send({ message: "forbidden access" });
      }

      const token = req.headers.authorization.split(" ")[1];
      console.log("access token", process.env.ACCESS_TOKEN_SECRET);
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: "forbidden" });
        }
        req.decoded = decoded;
        next();
      });
    };

    //verify admin after verify token
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      query = { email: email };
      const user = await userDB.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //chat related api
    app.get("/messages/:userEmail", verifyToken, async (req, res) => {
      const userEmail = req.params.userEmail;

      if (req.decoded.email !== userEmail) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const messages = await messageDB
        .find({ userEmail })
        .sort({ timestamp: 1 })
        .toArray();
      res.send(messages);
    });

    app.get(
      "/admin/messages/:userEmail",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const userEmail = req.params.userEmail;

        const messages = await messageDB
          .find({ userId: userEmail })
          .sort({ timestamp: 1 })
          .toArray();
        res.send(messages);
      }
    );

    // menu related api
    app.get("/menu", async (req, res) => {
      const result = await menuDB.find().toArray();
      res.send(result);
    });

    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuDB.findOne(query);
      res.send(result);
    });

    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuDB.insertOne(item);
      res.send(result);
    });

    app.patch("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          recipe: item.recipe,
          image: item.image,
        },
      };
      const result = await menuDB.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const query = { _id: new ObjectId(id) };
      const result = await menuDB.deleteOne(query);
      res.send(result);
    });

    //review related api

    app.get("/reviews", async (req, res) => {
      const result = await reviewsDB.find().toArray();
      res.send(result);
    });

    app.get("/reviews/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await reviewsDB.find(query).toArray();
      res.send(result);
    });

    app.post("/reviews", verifyToken, async (req, res) => {
      const item = req.body;
      // console.log(item);
      const result = await reviewsDB.insertOne(item);
      res.send(result);
    });

    //reservation related api

    //this api route is when the admin is fetching all the reservations made by all the users
    app.get("/reservation", verifyToken, verifyAdmin, async (req, res) => {
      const result = await bookingsDB.find().toArray();
      res.send(result);
    });

    //this api route for individual user to see their own bookings
    app.get("/reservation/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await bookingsDB.find(query).toArray();
      res.send(result);
    });

    //this api route is when the user is making reservation
    app.post("/reservation", verifyToken, async (req, res) => {
      const item = req.body;
      console.log(item);
      const result = await bookingsDB.insertOne(item);
      // when user books new reservation it sends signal to database that new reservation is made
      if (result.insertedId) {
        console.log("Emitting newReservation ", item);
        io.emit("newReservation", { id: result.insertedId, ...item });
      }
      res.send(result);
    });

    //this api route is for the admin when he wants to approve or cancel a reservation
    app.patch(
      "/reservation/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        //console.log(status);
        const result = await bookingsDB.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        // when update happens sends signal to user that updated
        if (result.modifiedCount > 0) {
          //all client gets the update
          io.emit("reservationUpdated", { id, status });
        }
        //console.log(result);
        res.send(result);
      }
    );

    app.delete("/reservation/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsDB.deleteOne(query);
      res.send(result);
    });

    //contact related api
    app.post("/contact", async (req, res) => {
      const comment = req.body;
      //console.log(comment);
      const result = await contactDB.insertOne(comment);
      res.send(result);
    });

    //cart related api
    app.get("/carts", verifyToken, async (req, res) => {
      console.log("Getting /cart route hit");
      const email = req.query.email;
      //console.log("email received", email);
      const query = { email: email };
      const result = await cartDB.find(query).toArray();
      //console.log("Email received", email);
      const result2 = await cartDB.find().toArray();
      //console.log(result2);
      res.send(result);
    });

    app.post("/carts", verifyToken, async (req, res) => {
      const cartItem = req.body;
      const result = await cartDB.insertOne(cartItem);
      res.send(result);
    });

    app.delete("/carts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartDB.deleteOne(query);
      res.send(result);
    });

    //payment related apis

    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentDB.find(query).toArray();
      res.send(result);
    });

    app.get("/payments", verifyToken, verifyAdmin, async (req, res) => {
      const result = await paymentDB.find().toArray();
      //console.log(result);
      res.send(result);
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      //as everything is calculated in poisa in stripe
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentDB.insertOne(payment);

      //carefully delete each item from the cart
      console.log("payment info", payment);
      const query = {
        _id: {
          $in: payment.cartIds.map(id => new ObjectId(id)),
        },
      };
      const deleteResult = await cartDB.deleteMany(query);
      res.status(200).send({
        paymentResult,
        deleteResult,
      });
    });

    //user related api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userDB.find().toArray();
      res.send(result);
    });

    app.get("/user/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "unauthorized access" });
      }

      const query = { email: email };
      const user = await userDB.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;

      //insert email if user doesn't exists:
      // it can be done many ways (1.email 2.upsert 3.simple checking)

      const query = { email: user.email };
      const existingUser = await userDB.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists" });
      }
      const result = await userDB.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userDB.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userDB.deleteOne(query);
      res.send(result);
    });

    //stats or analytics
    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      //estimatedDocumentCount niye ghata ghati koro
      const users = await userDB.estimatedDocumentCount();
      const foodItems = await menuDB.estimatedDocumentCount();
      const orders = await paymentDB.estimatedDocumentCount();

      //this is not the best way
      //const payments = await paymentDB.find().toArray();
      //const revenue = payments.reduce(
      //  (total, payment) => total + payment.price,
      //  0
      //);
      const result = await paymentDB
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: "$price",
              },
            },
          },
        ])
        .toArray();
      console.log(result);
      const revenue =
        result.length > 0
          ? Number(parseFloat(result[0].totalRevenue).toFixed(2))
          : 0;

      res.send({
        users,
        foodItems,
        orders,
        revenue,
      });
    });

    //using aggregate pipeline
    app.get("/order-stats", verifyToken, verifyAdmin, async (req, res) => {
      // console.log("Hitting the order stat");
      const result = await paymentDB
        .aggregate([
          {
            $unwind: "$menuIds",
          },
          {
            $lookup: {
              from: "menu",
              localField: "menuIds",
              foreignField: "_id",
              as: "menuItems",
            },
          },
          {
            $unwind: "$menuItems",
          },
          {
            $group: {
              _id: "$menuItems.category",
              quantity: {
                $sum: 1,
              },
              revenue: { $sum: "$menuItems.price" },
            },
          },
          {
            $project: {
              _id: 0,
              category: "$_id",
              quantity: "$quantity",
              revenue: "$revenue",
            },
          },
        ])
        .toArray();
      //console.log(result);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    //await client.db("admin").command({ ping: 1 });
    //console.log(
    //  "Pinged your deployment. You successfully connected to MongoDB!"
    //);
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("E commerce server side");
});

server.listen(port, () => {
  console.log("Bistro Boss server with socketio running");
});
