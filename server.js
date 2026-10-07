const express = require('express');
const mysql = require('mysql2');
const body_parser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
require('dotenv').config(); // For environment variables

const app = express();

// Middleware for body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());  // Parse JSON data

// Middleware for serving static files
app.use(express.static('public'));

// Set EJS as template engine
app.set('view engine', 'ejs');

// Create MySQL Connection Pool
const connection = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'test',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'Pr@veen2005',
});

// Check MySQL Database Connection
connection.getConnection((error, conn) => {
    if (error) {
        console.error('Error connecting to the database:', error.stack);
        return;
    }
    console.log('MySQL Database connected successfully');
    conn.release();
});

// Session Middleware
app.use(
    session({
        secret: process.env.SESSION_SECRET || '1234567890abcdefghijklmnopqrstuvwxyz',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }, // Change to true when using HTTPS
    })
);

// Social links (to be passed globally)
const socialLinks = {
    facebook: 'https://www.facebook.com',
    twitter: 'https://www.twitter.com',
    instagram: 'https://www.instagram.com',
};

// Middleware to initialize session cart
app.use((req, res, next) => {
    if (!req.session.cart) {
        req.session.cart = [];
    }
    next();
});

// Middleware to make global variables available in views
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.cart = req.session.cart || [];
    res.locals.socialLinks = socialLinks;
    res.locals.activePage = req.path.split('/')[1] || 'home';
    next();
});

// Middleware to check if user is logged in
function isLoggedIn(req, res, next) {
    if (req.session.user) {
        return next();
    }
    res.redirect('/login');
}

// Home Page (Public Access: Display Products)
app.get('/', (req, res) => {
    const query = 'SELECT * FROM product';
    connection.query(query, (error, result) => {
        if (error) {
            console.error('Error fetching products:', error.stack);
            return res.status(500).send('Error fetching data');
        }
        res.render('product', { products: result });
    });
});

// Add to Cart
app.post('/add_cart', isLoggedIn, (req, res) => {
    const { product_id, product_name, product_price } = req.body;
    let found = false;

    req.session.cart.forEach((item) => {
        if (item.product_id === product_id) {
            item.quantity += 1;
            found = true;
        }
    });

    if (!found) {
        req.session.cart.push({
            product_id,
            product_name,
            product_price: parseFloat(product_price),
            quantity: 1,
        });
    }
    res.redirect('/');
});

// Remove Item from Cart
app.get('/remove_item', isLoggedIn, (req, res) => {
    const product_id = req.query.id;
    req.session.cart = req.session.cart.filter((item) => item.product_id !== product_id);
    res.redirect('/');
});

// Dashboard (Post Login: Manage Products and Orders)
app.get('/dashboard', isLoggedIn, (req, res) => {
    const query = 'SELECT * FROM orders WHERE user_id = ?';
    connection.query(query, [req.session.user.id], (error, results) => {
        if (error) {
            console.error('Error fetching orders:', error);
            return res.status(500).send('Error fetching orders');
        }
        res.render('dashboard', { orders: results || [] });
    });
});

// My Orders (Post Login: Display Cart Items)
app.get('/myorders', isLoggedIn, (req, res) => {
    const query = 'SELECT * FROM orders WHERE user_id = ?';
    connection.query(query, [req.session.user.id], (error, results) => {
        if (error) {
            console.error('Error fetching orders:', error);
            return res.status(500).send('Error fetching orders');
        }
        res.render('myorders', { orders: results });
    });
});

// Public Pages: Careers, Contact, Feedback
app.get('/careers', (req, res) => res.render('careers'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/feedback', (req, res) => res.render('feedback'));

// Sign Up
app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).send("All fields are required.");
    }

    // Hash password before storing it
    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
            console.error("Error hashing password:", err);
            return res.status(500).send("Internal server error.");
        }

        const query = "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";
        connection.query(query, [name, email, hashedPassword], (error, result) => {
            if (error) {
                console.error("Error inserting user:", error);
                return res.status(500).send("Error signing up.");
            }
            res.redirect('/login'); // Redirect to login page after signup
        });
    });
});

// Log In
app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT * FROM users WHERE email = ?';
    connection.query(query, [email], (error, results) => {
        if (error) {
            console.error(error);
            return res.status(500).send('Server error');
        }
        if (results.length === 0) {
            return res.status(400).send('Invalid credentials');
        }
        const user = results[0];
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err || !isMatch) {
                return res.status(400).send('Invalid credentials');
            }
            req.session.user = user;
            res.redirect('/dashboard');
        });
    });
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Server error');
        }
        res.redirect('/login');
    });
});

app.post('/order_confirmation', isLoggedIn, (req, res) => {
    if (!req.session.cart || req.session.cart.length === 0) {
        return res.status(400).send("Cart is empty!");
    }

    const userId = req.session.user.id; // Assuming the user is logged in
    const orders = req.session.cart;

    const query = `INSERT INTO orders (user_id, product_id, product_name, product_price, quantity, total_amount, status)
                   VALUES ?`;

    const orderValues = orders.map(item => [
        userId,
        item.product_id,
        item.product_name,
        item.product_price,
        item.quantity,
        item.product_price * item.quantity,
        'pending'
    ]);
   
    
    connection.query(query, [orderValues], (error, result) => {
        if (error) {
            console.error("Error inserting order:", error);
            return res.status(500).send("Error processing order.");
        }

        req.session.cart = []; // Clear cart after placing order
        res.redirect('/payment_gateway'); // Redirect to payment page
    });
});

app.post('/delete_order', isLoggedIn, (req, res) => {
    const orderId = req.body.order_id;

    if (!orderId) {
        return res.status(400).send("Invalid request!");
    }

    const query = "DELETE FROM orders WHERE id = ?";

    connection.query(query, [orderId], (error, result) => {
        if (error) {
            console.error("Error deleting order:", error);
            return res.status(500).send("Error deleting order.");
        }

        res.redirect('/myorders'); // Redirect back to orders page after deletion
    });
});

app.post('/update_order', isLoggedIn, (req, res) => {
    const { order_id, quantity, status } = req.body;

    if (!order_id || !quantity || !status) {
        return res.status(400).send("Invalid request data.");
    }

    const query = "UPDATE orders SET quantity = ?, total_amount = product_price * ?, status = ? WHERE id = ?";

    connection.query(query, [quantity, quantity, status, order_id], (error, result) => {
        if (error) {
            console.error("Error updating order:", error);
            return res.status(500).send("Error updating order.");
        }

        res.redirect('/myorders'); // Redirect back to orders page after updating
    });
});


app.get('/payment_gateway', isLoggedIn, (req, res) => {
    res.render('payment_gateway'); // Create payment_gateway.ejs in views folder
});

// 404 Page Handler
app.use((req, res) => {
    res.status(404).render('404');
});

// Start Server
const PORT = process.env.PORT || 4000; // Use 4000 if no PORT is set
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});