const express = require('express')
const app = express()
const bodyParser = require('body-parser')

const cors = require('cors')

const mongoose = require('mongoose')
mongoose.connect(process.env.MONGO_URI)

app.use(cors())

app.use(bodyParser.urlencoded({extended: false}))
app.use(bodyParser.json())


app.use(express.static('public'))
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html')
});

var dateOptions = {weekday: 'long', year:'numeric', month:'long', day:'numeric'}

var UserIdGeneratorSchema = new mongoose.Schema({
  name: String,
  currentId: Number
})

var ExercisesSchema = new mongoose.Schema({
  description: String,
  duration: Number,
  date: Date
})

var PersonSchema = new mongoose.Schema({
  username: String,
  userId: Number,
  workouts: [ExercisesSchema]
}, {usePushEach: true})

var UserIdGen = mongoose.model('UserIdGen', UserIdGeneratorSchema);
var Person = mongoose.model('Person', PersonSchema); 

function createUserIdGen(callback) {
  var newGen = new UserIdGen({name: "UserIdGen", currentId: 100})
  newGen.save(function(err, result) {
    if (err) console.error(err);
    incrementUserId(callback);
  });
}

function incrementUserId(callback) {
  UserIdGen.findOne({name: "UserIdGen"}, function(err, result) {
    if (err) console.error(err);
    result.currentId += 1
    result.save(function(err, result) {
      if (err) console.error(err);      
    })
    callback(result.currentId)
  })
}  

function checkIfExists(collection, searchJson, callback) {
  collection.find(searchJson, function(err, results) {    
    if (err) console.error(err);
    if (results.length != 0) {      
      callback(true)
    } else {      
      callback(false)
    }
  })
}

function createNewUser(id, username, callback) {
  var newUser = new Person({username: username.toLowerCase(), userId: id})
  newUser.save(function(err, result) {
    if (err) console.error(err);
    callback()
  })
}

function addExerciseToDb(record, callback) {
  Person.findOne({userId: record.userId}, function(err, result) {
    if (err) console.error(err);
    if (record.date == '') {
      record.date = new Date()
    }
    result.workouts.push({
      description: record.description,
      duration: record.duration,
      date: record.date
    })    
    result.workouts.sort(function(a, b) {
      return b.date - a.date})
    result.save(function(err, result) {
      if (err) console.error(err);
    })
    callback(result)
  })
}

function getDbRecord(searchJson, callback) {
  Person.findOne(searchJson, function(err, result) {
    if (err) console.error(err);    
    callback(result)
  })
}

app.post('/api/exercise/new-user', function(req, res) {
  checkIfExists(Person, {username: req.body.username}, function(exists) {
    if (exists) {
      res.type('text').send('That username already exists.')
    } else {      
      checkIfExists(UserIdGen, {}, function(exists) {        
        if (exists) {
        incrementUserId(function(id) {          
          createNewUser(id, req.body.username, function() {            
            res.json({[req.body.username]: id});
          })
        })          
      } else {        
        createUserIdGen(function(id) {
          createNewUser(id, req.body.username, function() {            
            res.json({[req.body.username]: id});
          })
        })
      }
    })
    }
  })
});

app.get('/api/exercise/users', function(req, res) {  
  Person.find({}, {username:1, userId:1, _id:0}, function(err, results) {
    if (err) console.error(err);        
    var modResults = results.map(item => ({[item.username]:item.userId}))
    res.json(modResults)    
  })  
})

app.post('/api/exercise/add', function(req, res) {
  checkIfExists(Person, {userId: req.body.userId}, function(exists) {
    if (!exists) {
      res.type('text').send('Incorrect userId')
    } else {
      addExerciseToDb(req.body, function(result) {        
        var newWorkout = result.workouts.slice(0)[0];        
        newWorkout = {description: newWorkout.description, duration:newWorkout.duration, date:newWorkout.date.toLocaleDateString("en-US", dateOptions)}        
        var profile = {[result.username]: result.userId, new_workout: newWorkout}
        res.json(profile)
      })      
    }
  })
});

app.get('/api/exercise/log:user', function(req, res) {  
  checkIfExists(Person, {userId: req.params.user}, function(exists) {
    if (!exists) {
      res.type('text').send('Incorrect userId')
    } else {
      getDbRecord({userId: req.params.user}, function(record) {        
        var numWorkouts = record.workouts.length;        
        var workouts = record.workouts.map(w => ({description: w.description, duration: w.duration, data: w.date.toLocaleDateString("en-US", dateOptions)}))        
        var profile = {[record.username]:record.userId,
                      total_workouts: numWorkouts,
                      exercise_log: workouts};        
        res.json(profile);
      })
    }
  })
});

app.get('/api/exercise/log', function(req, res) {
  checkIfExists(Person, {userId: req.query.userId}, function(exists) {
    if (!exists) {
      res.type('text').send('Incorrect userId')
    } else {
      getDbRecord({userId: req.query.userId}, function(record) {                        
        var fromDate = new Date(req.query.from) == 'Invalid Date' ? new Date(0) : new Date(req.query.from) 
        var toDate = new Date(req.query.to) == 'Invalid Date' ? new Date() : new Date(req.query.to)         
        var adjWorkouts = record.workouts.filter(w => w.date < toDate && w.date > fromDate)
        if (req.query.limit) {
          adjWorkouts = adjWorkouts.slice(0, req.query.limit)
        }        
        var workouts = adjWorkouts.map(w => ({description: w.description, duration: w.duration, data: w.date.toLocaleDateString("en-US", dateOptions)}))          
        var profile = {[record.username]:record.userId,                      
                      exercise_log: workouts};
        res.json(profile)
      })
    }
  })
});
  

// Not found middleware
app.use((req, res, next) => {
  return next({status: 404, message: 'not found'})
})

// Error Handling middleware
app.use((err, req, res, next) => {
  let errCode, errMessage

  if (err.errors) {
    // mongoose validation error
    errCode = 400 // bad request
    const keys = Object.keys(err.errors)
    // report the first validation error
    errMessage = err.errors[keys[0]].message
  } else {
    // generic or custom error
    errCode = err.status || 500
    errMessage = err.message || 'Internal Server Error'
  }
  res.status(errCode).type('txt')
    .send(errMessage)
})

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port)
})
