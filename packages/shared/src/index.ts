export type ApiResponse<T> = {
  data: T;
  message?: string;
};

export type JwtPayload = {
  sub: string;
  email: string;
};
