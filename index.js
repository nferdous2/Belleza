require('dotenv').config()

const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
// console.log('Stripe Secret Key:', process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 8000;

// middleware
app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yhxur.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const serviceCollection = client.db("parlour").collection("data");
    const cartCollection = client.db("parlour").collection("cartItems");
    const usersCollection = client.db("parlour").collection("users");
    const paymentCollection = client.db("parlour").collection("payments");
    const  reviewCollection = client.db("parlour").collection("reviews");

    //jwt token


    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_TOKEN_SECRET, {
        expiresIn: '1h'
      });
      res.send({ token })
    })
    //middlewares
    const verifyToken = (req, res, next) => {
      console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'unauthorized access' });
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.JWT_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
      })
    }

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next();
    }

    //users end point
    app.post('/users', async (req, res) => {
      const users = req.body;
      //insert if user does not exist
      const query = { email: users.email }
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null })
      }
      const result = await usersCollection.insertOne(users);
      res.send(result);
    });

    app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    })
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    })

    //admin
    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })

    ///get the aadmin
    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' })
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin';
      }
      res.send({ admin });
    })


    //products
    app.get('/data', async (req, res) => {
      const result = await serviceCollection.find().toArray();
      res.send(result);
    })
    // //post data

    app.post('/addData', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { category, item } = req.body;

        // Generate a new ID for the item
        item._id = new ObjectId(); // Ensure ObjectId is imported correctly

        // Update or insert the item into MongoDB collection
        const filter = { category };
        const updateDoc = {
          $push: {
            items: {
              _id: item._id,
              name: item.name,
              price: item.price,
              description: item.description,
              duration: item.duration,
              popular: item.popular,
              image: item.image
              // Add more fields as needed
            }
          }
        };
        const options = { upsert: true };

        const result = await serviceCollection.updateOne(filter, updateDoc, options);

        if (result.modifiedCount === 0 && result.upsertedCount === 0) {
          throw new Error('Failed to add or update data');
        }

        // Retrieve the updated document
        const updatedDocument = await serviceCollection.findOne(filter);

        res.status(201).json({ success: true, data: updatedDocument.items });
      } catch (error) {
        console.error('Error adding data:', error);
        res.status(500).json({ success: false, error: 'Failed to add data' });
      }
    });
    //delete the data
    app.delete('/deleteData/:id', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;

        // Convert the id to ObjectId
        const objectId = new ObjectId(id);

        // Find and delete the item
        const filter = { 'items._id': objectId };
        const updateDoc = {
          $pull: {
            items: { _id: objectId }
          }
        };

        const result = await serviceCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount === 0) {
          throw new Error('Failed to delete data');
        }

        res.status(200).json({ success: true, message: 'Item deleted successfully' });
      } catch (error) {
        console.error('Error deleting data:', error);
        res.status(500).json({ success: false, error: 'Failed to delete data' });
      }
    });


    // carts collection
    app.get('/carts', async (req, res) => {

      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });
    app.post('/carts', async (req, res) => {
      const cartItem = req.body;
      const { serviceId, email } = cartItem;
    
      // Check if the item already exists in the cart
      const existingCartItem = await cartCollection.findOne({ serviceId, email });
    
      if (existingCartItem) {
        // If the item exists, send a response indicating it
        return res.send({ message: 'Item already in cart', success: false });
      }
    
      // If the item doesn't exist, insert it into the cart
      const result = await cartCollection.insertOne(cartItem);
      res.send({ ...result, success: true });
    });

    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    })

    //payments
    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      console.log(`Creating payment intent for amount: ${amount}`);
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: 'usd',
          payment_method_types: ['card']
        });

        res.send({
          clientSecret: paymentIntent.client_secret
        });
      } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).send({ error: error.message });
      }
    });
    //post payment
    app.post('/payments', async (req, res) => {
      const payment = req.body;
      const payResult = await paymentCollection.insertOne(payment);
      const query = {
        _id: {
          $in: payment.cartId.map(id => new ObjectId(id))
        }
      }
      const deleteResult = await cartCollection.deleteMany(query)
      res.send({ payResult, deleteResult });
    });

    app.get('/payments/:email', verifyToken, async (req, res) => {
      const query = { email: req.params.email }
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    })
    // Admin stats or analytics
    app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
      try {
        // Get counts for users, menu items, and orders
        const users = await usersCollection.estimatedDocumentCount();
        const serviceData = await serviceCollection.estimatedDocumentCount();
        const orders = await paymentCollection.estimatedDocumentCount();

        // Aggregate total revenue
        const revenueResult = await paymentCollection.aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: '$price'
              }
            }
          }
        ]).toArray();
        const revenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

        // Fetch all payments for payment history
        const paymentHistory = await paymentCollection.find().toArray();

        // Send all collected data
        res.send({
          users,
          serviceData,
          orders,
          revenue,
          paymentHistory
        });
      } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    app.patch('/update-status/:id', verifyToken, verifyAdmin, async (req, res) => {
      const paymentId = req.params.id;
      try {
        const result = await paymentCollection.updateOne(
          { _id: new ObjectId(paymentId) },
          { $set: { status: 'confirmed' } }
        );
        if (result.modifiedCount === 1) {
          res.send({ message: 'Status updated successfully' });
        } else {
          res.status(404).send({ message: 'Payment not found' });
        }
      } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    //reviews
    app.post('/give-reviews', async (req, res) =>{
      const reviews = req.body;
      const result = await reviewCollection.insertOne(reviews);
      res.send(result);
    })
    app.get('/reviews', async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Belleza is running')
})

app.listen(port, () => {
  console.log(`Belleza is running on port ${port}`);
})
