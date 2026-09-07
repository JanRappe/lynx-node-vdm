lynx-node-vdm
====================
Node.js Web Scoreboard for FinishLynx that emulates a VDM (Visual Display Module) compatible with FinishLynx VDM.lss scoreboard scripts.

Inspired by chrissabato's [lynx-node-scoreboard](https://github.com/chrissabato/lynx-node-scoreboard)

Only works on local networks.

## Node Server
+ install [node.js](http://nodejs.org/)
  + add node to PATH (windows installer sometimes doesn't do this by default)
    + open cmd prompt as administrator
    + SET PATH=C:\Program Files\Nodejs;%PATH%
+ create a folder for you Node project (c:\node)
+ install dependencies
  + must be in the same directory as the node project
  + from a command prompt, run:
    + CD c:\node
    + npm ci
    
## FinishLynx Setup
+ setup scoreboard in FinishLynx
  + Script: any VDM.lss script 
  + Code Set: Single Byte
  + Serial Port: Network (UDP)
  + Port: 43278 
  + IP Address: IP-Address of the server (127.0.0.1 if on the same machine)
  + Running Time: Auto
  + Results: Auto
  + Alway send place: checked
  + Paging: checked
  + Size: 3
  + Max: 6 (The max number of competitors in an event)
  + Include first name: checked
  
## Run Server
+ start the node server
  + npm start

## Access Scoreboard
+ Open a browser and enter [IP-Adress]:8050 (without the brackets) into the address bar
