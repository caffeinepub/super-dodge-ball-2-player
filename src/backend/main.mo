import Map "mo:core/Map";
import Text "mo:core/Text";
import Random "mo:core/Random";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Int "mo:core/Int";
import Order "mo:core/Order";
import VarArray "mo:core/VarArray";

actor {
  type BallData = {
    x : Float;
    y : Float;
    speed : Float;
    vy : Float;
  };

  type RoomState = {
    p1Y : Float;
    p2Y : Float;
    balls : [BallData];
    p1Hits : Nat;
    p2Hits : Nat;
    gameOver : Bool;
    winner : Text;
    p2Joined : Bool;
    p2ThrowBall : Bool;
    lastUpdated : Int;
  };

  let rooms = Map.empty<Text, RoomState>();

  func generateCode() : async* Text {
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let letterIter = alphabet.chars();
    let letterArray = letterIter.toArray();
    var code = "";
    let random = Random.crypto();
    var i = 0;
    while (i < 6) {
      let index = await* random.natRange(0, 26); // Explicit await* used for looped random use per M0514, see #7912.
      let char = letterArray[index];
      code #= char.toText();
      i += 1;
    };
    code;
  };

  public shared ({ caller }) func createRoom() : async Text {
    var code = "";
    var unique = false;
    while (not unique) {
      code := await* generateCode();
      unique := not rooms.containsKey(code);
    };
    let state : RoomState = {
      p1Y = 50.0;
      p2Y = 50.0;
      balls = [];
      p1Hits = 0;
      p2Hits = 0;
      gameOver = false;
      winner = "";
      p2Joined = false;
      p2ThrowBall = false;
      lastUpdated = Time.now();
    };
    rooms.add(code, state);
    code;
  };

  public shared ({ caller }) func joinRoom(code : Text) : async Bool {
    switch (rooms.get(code)) {
      case (null) {
        false;
      };
      case (?existing) {
        switch (existing.p2Joined) {
          case (true) {
            false;
          };
          case (false) {
            let newState = {
              existing with p2Joined = true;
              lastUpdated = Time.now();
            };
            rooms.add(code, newState);
            true;
          };
        };
      };
    };
  };

  public shared ({ caller }) func pushHostState(
    code : Text,
    p1Y : Float,
    p2Y : Float,
    balls : [BallData],
    p1Hits : Nat,
    p2Hits : Nat,
    gameOver : Bool,
    winner : Text,
  ) : async () {
    let state = switch (rooms.get(code)) {
      case (null) { Runtime.trap("Room not found") };
      case (?s) {
        {
          s with p1Y;
          p2Y;
          balls;
          p1Hits;
          p2Hits;
          gameOver;
          winner;
          lastUpdated = Time.now();
        };
      };
    };
    rooms.add(code, state);
  };

  public shared ({ caller }) func pushGuestInput(
    code : Text,
    p2Y : Float,
    throwBall : Bool,
  ) : async () {
    let updatedState = switch (rooms.get(code)) {
      case (null) { Runtime.trap("Room not found") };
      case (?s) {
        if (not s.p2Joined) { Runtime.trap("P2 not joined") };
        {
          s with p2Y;
          p2ThrowBall = throwBall;
          lastUpdated = Time.now();
        };
      };
    };
    rooms.add(code, updatedState);
  };

  public query ({ caller }) func getState(code : Text) : async ?RoomState {
    switch (rooms.get(code)) {
      case (null) {
        null;
      };
      case (?state) {
        func compare(a : BallData, b : BallData) : Order.Order {
          Float.compare(a.x, b.x);
        };
        let mutableBalls : [var BallData] = state.balls.toVarArray();
        mutableBalls.sortInPlace();
        let sortedBalls = mutableBalls.toArray();
        let res : RoomState = {
          state with balls = sortedBalls;
          p2ThrowBall = false;
        };
        rooms.add(code, res);
        ?state;
      };
    };
  };
};
