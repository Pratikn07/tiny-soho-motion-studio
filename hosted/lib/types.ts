export type Owner = {
  userId: string;
  email: string;
};

export type OwnedRecord = {
  id: string;
  owner_user_id: string;
};
