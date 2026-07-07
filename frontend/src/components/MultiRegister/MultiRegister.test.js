import React from "react";
import { shallow } from "enzyme";
import MultiRegister from "./MultiRegister";

describe("MultiRegister", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<MultiRegister />);
    expect(wrapper).toMatchSnapshot();
  });
});
