var
  _ = require('underscore'),
  lpBitMask = require('../public/javascripts/letterpress-bitmask'),
    countBits = lpBitMask.countBits,
  lpConfig = require('./letterpress-config'),
  getBitMaskForPositions = require('./letterpress-getBitMask').getBitMaskForPositions;


/**
 * Given a string representing a board, return a map of
 * characters to bitmap of where each letter is used on the board
 * e.g. given "abac", return { a: [1, 4], b: [2], c: [8] }
 *
 * @param {String} board
 * @return {Array} as described above
 */
function getBoardPositionMap(board) {
  var boardMap = {};
  for (var i = 0; i < board.length; i += 1) {
    var c = board[i];
    if (!(c in boardMap)) {
      boardMap[c] = [];
    }
    boardMap[c].push(Math.pow(2, i));
  }
  return boardMap;
}

function getMovesForBoard(board, wordStructs) {
  // an index of where letters are, on the board
  var boardPositionMap = getBoardPositionMap(board);
  var moves = [];

  wordStructs.forEach(function(wordStruct) {

    // make a histogram of the letters in the word
    // n.b. it seems like this could be precalculated, but that is slower & uses more memory
    // at this point we are probably dealing with only a few hundred words anyway
    var letterCounts = _.countBy(wordStruct[1], _.identity);
    var posCombos = [];

    for (c in letterCounts) {
      // in all the positions where c is on the board, create as many combos as we need for this word,
      // and add that to posCombos
      // e.g. if we want two "a", and "a" appears four times on the board, we'll get six combos of the four positions
      posCombos.push(kCombinations(boardPositionMap[c], letterCounts[c]));
    }

    // flatten combos out into possible board positions for this word
    flattenCombos(posCombos).forEach(function(bitmap) {
      moves.push([wordStruct, bitmap]);
    });

  });

  return moves;

}


/**
 * Given the possible combinations of board positions, produce a flattened list.
 * i.e. if the board is "abcb" and the word is "cab", the position combos should be:
 *    [ [ 4 ], [ 1 ], [ 2, 8 ] ]
 * and the flattened combos should be:
 *    [ 1|2|4, 1|2|8 ]
 * or more succinctly:
 *    [ 7, 11 ]
 * @param {Array} posCombos as described above
 * @return {Array} flattened combinations as described above
 */
function flattenCombos(posCombos) {
  var results = [];
  function pc(i, curr) {
    var opts = posCombos[i];
    for (var j = 0; j < opts.length; j++) {
      var myCurr = curr | opts[j];
      if (i + 1 == posCombos.length) {
        results.push(myCurr);
      } else {
        pc(i + 1, myCurr);
      }
    }
  }
  if (posCombos.length > 0) {
    pc(0, []);
  }
  return results;
}


/**
 * Given a list of numbers (single bits), obtain all combinations of those bits where a certain number of bits are on
 * @param {Array} bits
 * @param {Number} count
 * @return {Array} of bitmaps
 */
function kCombinations(bits, count) {
  var results = [];
  function kc(count, start, curr) {
    for (var i = start; i < bits.length; i++) {
      var myCurr = curr;
      myCurr |= bits[i];
      if (count === 1) {
        results.push(myCurr);
      } else {
        kc(count - 1, i + 1, myCurr)
      }
    }
  }
  if (count !== 0) {
    kc(count, 0, 0);
  }
  return results;
}

function getTopMoves(moves, oursBitMask, theirsBitMask) {

  // add other bitmask metrics to help sort best move
  var oursProtectedBitMask = lpBitMask.getProtectedBitMask(oursBitMask)
  var theirsProtectedBitMask = lpBitMask.getProtectedBitMask(theirsBitMask);

  // let's now add some information to a new array, for each move we rate how good it is
  // given current game state
  var movesScoredForGameState = moves.map(function(move) {
    var wordStruct = move[0];
    var wordBitMask = move[1];
    var newOursBitMask = (wordBitMask & ~theirsProtectedBitMask) | oursBitMask;
    var newOursProtectedBitMask = lpBitMask.getProtectedBitMask(newOursBitMask);
    var newTheirsBitMask = theirsBitMask & ~newOursBitMask;
    var newTheirsProtectedBitMask = lpBitMask.getProtectedBitMask(newTheirsBitMask);
    var newOursCount = countBits(newOursBitMask);
    var newTheirsCount = countBits(newTheirsBitMask);
    var newOursProtectedCount = countBits(newOursProtectedBitMask);
    var newTheirsProtectedCount = countBits(newTheirsProtectedBitMask);
    var vulnerability = getVulnerability(newOursProtectedBitMask);

    var gameEnder = 0;
    if ((newOursBitMask | newTheirsBitMask) === lpConfig.MAX_BITMASK) {
      gameEnder = (newOursCount >= lpConfig.POSITIONS_TO_WIN) ? 1 : -1;
    }

    // and let's add this to the moves!
    return([
      newOursProtectedCount - newTheirsProtectedCount,
      newOursCount - newTheirsCount,
      gameEnder,
      newOursBitMask,
      newTheirsBitMask,
      wordBitMask,
      wordStruct,
      vulnerability
    ]);
  });

  return filterMoves(movesScoredForGameState.sort(byBestMove))
          .slice(0, 19)
          .map(function(move) {
            // send ["word", wordBitMask, newOursBitMask, newTheirsBitMask, gameEnder ]
            return [move[6][0], move[5], move[3], move[4], move[2]];
          });

}

/**
 * Comparator for moves
 * Note we sort by frequency ascending; if two words are similar, most common one
 * should be first. (i.e. "forward" sorts before "froward")
 * @param {Array} a move
 * @param {Array} b move
 * @return {Number}
 */
function byBestMove(a, b) {
  return (  // if we don't open with a paren, JS just returns nothing. sigh.
    (b[2] - a[2]) // sort winning moves first
    || (b[0] - a[0]) // more protected positions
    || (a[7] - b[7]) // least vulnerable positions
    || (b[1] - a[1]) // more positions
    || (a[6][2] - b[6][2]) // more common words first
  );
}



function filterMoves(moves) {

  // we use this in the filter, to only show new words with different scores.
  var latestScore = 0;
  var seen = {};

  return moves
    .filter(function(move){
      if (seen[move[6][0]] || (move[0] + move[1] === latestScore)) {
        return false;
      }
      latestScore = move[0] + move[1];
      seen[move[6][0]] = 1;
      return true;
    });

}


/**
 * Given a bitmask, decide how vulnerable it is to opponent
 * The most defensible positions are compact, with no "holes" for opponent to place a
 * square and build within our defended area. A square that can affect multiple squares of
 * our is particularly bad. So we sum up all adjacent squares for each
 * square (that we don't already have).
 * @param {Number} bitMask
 * @return {Number}
 */
function getVulnerability(bitMask) {
  var vulnerability = 0;
  lpBitMask.adjacent.forEach(function(a) {
    if (a[0] & bitMask) {
      vulnerability += countBits(a[1] & ~bitMask);
    }
  });
  return vulnerability;
}

exports.getMovesForBoard = getMovesForBoard;
exports.getTopMoves = getTopMoves;
exports.kCombinations = kCombinations;
exports.getBoardPositionMap = getBoardPositionMap;


