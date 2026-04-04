import { randomUUID } from "node:crypto";
import { FULL_FLAG_CATALOG, getDifficultyFlagCount, type RoomDifficulty } from "@flagwho/shared";
import type { RoomState } from "./types.js";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomCode(): string {
  return Array.from({ length: 6 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join("");
}

function shuffleFlags(flags: readonly string[]): string[] {
  const pool = [...flags];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool;
}

function selectFlagPool(difficulty: RoomDifficulty): string[] {
  const shuffled = shuffleFlags(FULL_FLAG_CATALOG);
  const targetCount = getDifficultyFlagCount(difficulty, shuffled.length);
  return shuffled.slice(0, targetCount);
}

export class RoomManager {
  private rooms = new Map<string, RoomState>();

  createRoom(socketId: string, displayName = "Player 1", difficulty: RoomDifficulty = "easy") {
    let roomCode = generateRoomCode();
    while (this.rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const playerId = randomUUID();
    const room: RoomState = {
      roomCode,
      difficulty,
      availableFlagCodes: selectFlagPool(difficulty),
      status: "waiting",
      players: [
        {
          playerId,
          socketId,
          seat: "p1",
          displayName,
          secretFlagCode: null,
          eliminatedFlagCodes: []
        }
      ],
      championship: {
        targetWins: 3,
        winsByPlayerId: { [playerId]: 0 },
        roundsPlayed: 0,
        matchWinnerPlayerId: null
      },
      round: null,
      chatLog: []
    };

    this.rooms.set(roomCode, room);
    return { room, player: room.players[0] };
  }

  joinRoom(roomCode: string, socketId: string, displayName = "Player 2") {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { error: "ROOM_NOT_FOUND" as const };
    }
    if (room.players.length >= 2) {
      return { error: "ROOM_FULL" as const };
    }

    const playerId = randomUUID();
    const player = {
      playerId,
      socketId,
      seat: "p2" as const,
      displayName,
      secretFlagCode: null,
      eliminatedFlagCodes: []
    };

    room.players.push(player);
    room.championship.winsByPlayerId[playerId] = 0;
    return { room, player };
  }

  getRoom(roomCode: string) {
    return this.rooms.get(roomCode);
  }

  findRoomByPlayerId(playerId: string) {
    for (const room of this.rooms.values()) {
      if (room.players.some((player) => player.playerId === playerId)) {
        return room;
      }
    }
    return null;
  }

  findPlayerRoom(socketId: string) {
    for (const room of this.rooms.values()) {
      if (room.players.some((player) => player.socketId === socketId)) {
        return room;
      }
    }
    return null;
  }

  getRoomCount() {
    return this.rooms.size;
  }

  closeRoom(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return null;
    }
    room.status = "closed";
    this.rooms.delete(roomCode);
    return room;
  }
}
